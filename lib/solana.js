/**
 * Solana integration for Social OS
 * - Wallet binding challenge + signature verification
 * - Proof-of-interaction recording with optional on-chain tx verification
 * - Reward payment transfer (SOL) and external reward settlement recording
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  Connection,
  PublicKey,
  Keypair,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from '@solana/web3.js';

const CHALLENGES_FILE = 'solana-challenges.json';
const PROOFS_FILE = 'proofs.json';
const PAYMENTS_FILE = 'payments.json';

function normalizeHandle(handle) {
  if (!handle) return '';
  return handle.startsWith('@') ? handle : `@${handle}`;
}

function nowIso() {
  return new Date().toISOString();
}

function getConnection(network = 'devnet', rpcUrl) {
  const endpoint = rpcUrl || (network.startsWith('http') ? network : clusterApiUrl(network));
  return new Connection(endpoint, 'confirmed');
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function toBufferFromSig(signature) {
  if (!signature) throw new Error('Missing signature');
  try {
    return Buffer.from(bs58.decode(signature));
  } catch {
    return Buffer.from(signature, 'base64');
  }
}

function getNodeKey(node) {
  return node.handle || node.id || node.did;
}

async function upsertWalletOnNode({ socialPath, handle, walletAddress, challengeId }) {
  const nodesPath = path.join(socialPath, 'nodes.json');
  const nodes = await readJson(nodesPath, []);
  const normalizedHandle = normalizeHandle(handle);
  const verifiedAt = nowIso();

  let matched = false;
  const updated = nodes.map((node) => {
    if (node.handle === normalizedHandle || node.id === normalizedHandle) {
      matched = true;
      const meta = node.meta || {};
      return {
        ...node,
        walletAddress,
        walletVerifiedAt: verifiedAt,
        trustScoreOnchain: Math.max(Number(node.trustScoreOnchain || 0), 1),
        meta: {
          ...meta,
          walletAddress,
          walletVerifiedAt: verifiedAt,
          walletVerificationMethod: 'solana-signature',
          walletChallengeId: challengeId
        }
      };
    }
    return node;
  });

  if (!matched) {
    updated.push({
      id: normalizedHandle,
      name: normalizedHandle.replace('@', ''),
      handle: normalizedHandle,
      source: 'local',
      walletAddress,
      walletVerifiedAt: verifiedAt,
      trustScoreOnchain: 1,
      meta: {
        walletAddress,
        walletVerifiedAt: verifiedAt,
        walletVerificationMethod: 'solana-signature',
        walletChallengeId: challengeId
      }
    });
  }

  await writeJson(nodesPath, updated);
  return { handle: normalizedHandle, walletAddress, walletVerifiedAt: verifiedAt };
}

export async function createWalletBindingChallenge({
  socialPath,
  handle,
  walletAddress,
  ttlMinutes = 10
}) {
  if (!handle) throw new Error('Missing handle');
  if (!walletAddress) throw new Error('Missing walletAddress');

  new PublicKey(walletAddress);

  const normalizedHandle = normalizeHandle(handle);
  const challengeId = crypto.randomUUID();
  const nonce = crypto.randomBytes(16).toString('hex');
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const message = [
    'OpenClaw Social OS wallet binding',
    `challenge_id=${challengeId}`,
    `handle=${normalizedHandle}`,
    `wallet=${walletAddress}`,
    `nonce=${nonce}`,
    `issued_at=${issuedAt}`,
    `expires_at=${expiresAt}`
  ].join('\n');

  const challengesPath = path.join(socialPath, CHALLENGES_FILE);
  const challenges = await readJson(challengesPath, []);
  const active = challenges.filter((c) => !c.usedAt && new Date(c.expiresAt).getTime() > Date.now());
  active.push({
    challengeId,
    handle: normalizedHandle,
    walletAddress,
    nonce,
    message,
    issuedAt,
    expiresAt,
    usedAt: null
  });
  await writeJson(challengesPath, active);

  return {
    challengeId,
    handle: normalizedHandle,
    walletAddress,
    message,
    expiresAt
  };
}

export async function verifyWalletBinding({
  socialPath,
  challengeId,
  signature,
  handle,
  walletAddress
}) {
  if (!challengeId) throw new Error('Missing challengeId');
  if (!signature) throw new Error('Missing signature');

  const challengesPath = path.join(socialPath, CHALLENGES_FILE);
  const challenges = await readJson(challengesPath, []);
  const challenge = challenges.find((c) => c.challengeId === challengeId);

  if (!challenge) throw new Error(`Challenge not found: ${challengeId}`);
  if (challenge.usedAt) throw new Error(`Challenge already used: ${challengeId}`);
  if (new Date(challenge.expiresAt).getTime() <= Date.now()) throw new Error('Challenge expired');

  if (handle && normalizeHandle(handle) !== challenge.handle) {
    throw new Error('Handle does not match challenge');
  }
  if (walletAddress && walletAddress !== challenge.walletAddress) {
    throw new Error('Wallet does not match challenge');
  }

  const messageBytes = new TextEncoder().encode(challenge.message);
  const signatureBuffer = toBufferFromSig(signature);
  const publicKeyBytes = new PublicKey(challenge.walletAddress).toBytes();
  const verified = nacl.sign.detached.verify(messageBytes, signatureBuffer, publicKeyBytes);

  if (!verified) throw new Error('Invalid signature');

  challenge.usedAt = nowIso();
  await writeJson(challengesPath, challenges);

  const binding = await upsertWalletOnNode({
    socialPath,
    handle: challenge.handle,
    walletAddress: challenge.walletAddress,
    challengeId
  });

  return {
    verified: true,
    challengeId,
    ...binding
  };
}

function hashProofPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function verifyTransactionIfRequested({ verifyTx, txSignature, network, rpcUrl }) {
  if (!verifyTx) return { verifiedOnchain: false };
  if (!txSignature) throw new Error('Missing txSignature for on-chain verification');

  const connection = getConnection(network, rpcUrl);
  const status = await connection.getSignatureStatus(txSignature, { searchTransactionHistory: true });
  const txStatus = status.value;
  if (!txStatus) throw new Error(`Transaction not found: ${txSignature}`);
  if (txStatus.err) throw new Error(`Transaction failed: ${JSON.stringify(txStatus.err)}`);

  return { verifiedOnchain: true, slot: txStatus.slot, confirmationStatus: txStatus.confirmationStatus };
}

export async function recordInteractionProof({
  socialPath,
  from,
  to,
  proofType,
  context,
  offchainData,
  txSignature,
  network = 'devnet',
  rpcUrl,
  verifyTx = false
}) {
  if (!from || !to) throw new Error('Missing from/to');
  if (!proofType) throw new Error('Missing proofType');

  const fromKey = normalizeHandle(from);
  const toKey = normalizeHandle(to);
  const timestamp = nowIso();

  const verification = await verifyTransactionIfRequested({
    verifyTx,
    txSignature,
    network,
    rpcUrl
  });

  const proofPayload = {
    from: fromKey,
    to: toKey,
    proofType,
    context: context || null,
    offchainData: offchainData || null,
    txSignature: txSignature || null,
    network,
    timestamp
  };
  const proofHash = hashProofPayload(proofPayload);
  const proofId = crypto.randomUUID();

  const proofsPath = path.join(socialPath, PROOFS_FILE);
  const proofs = await readJson(proofsPath, []);
  proofs.push({
    id: proofId,
    ...proofPayload,
    proofHash,
    ...verification
  });
  await writeJson(proofsPath, proofs);

  const edgesPath = path.join(socialPath, 'edges.json');
  const edges = await readJson(edgesPath, []);
  edges.push({
    from: fromKey,
    to: toKey,
    type: 'proof',
    proofType,
    proofId,
    proofHash,
    proofTx: txSignature || null,
    proofTimestamp: timestamp,
    source: 'solana'
  });
  await writeJson(edgesPath, edges);

  return {
    proofId,
    proofHash,
    from: fromKey,
    to: toKey,
    proofType,
    txSignature: txSignature || null,
    ...verification
  };
}

async function readKeypairFromFile(fromKeypairPath) {
  const keyRaw = await fs.readFile(fromKeypairPath, 'utf-8');
  const secret = Uint8Array.from(JSON.parse(keyRaw));
  return Keypair.fromSecretKey(secret);
}

export async function transferSolReward({
  socialPath,
  fromKeypairPath,
  toWallet,
  amountSol,
  network = 'devnet',
  rpcUrl,
  memo,
  fromHandle,
  toHandle
}) {
  if (!fromKeypairPath) throw new Error('Missing fromKeypairPath');
  if (!toWallet) throw new Error('Missing toWallet');
  if (!amountSol || Number(amountSol) <= 0) throw new Error('amountSol must be > 0');

  const payer = await readKeypairFromFile(fromKeypairPath);
  const destination = new PublicKey(toWallet);
  const connection = getConnection(network, rpcUrl);
  const lamports = Math.round(Number(amountSol) * LAMPORTS_PER_SOL);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: destination,
      lamports
    })
  );

  const txSignature = await sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: 'confirmed'
  });

  return await recordRewardPayment({
    socialPath,
    fromHandle,
    toHandle,
    fromWallet: payer.publicKey.toBase58(),
    toWallet: destination.toBase58(),
    amount: Number(amountSol),
    asset: 'SOL',
    txSignature,
    network,
    rpcUrl,
    note: memo || 'social-os reward transfer',
    verifyTx: true
  });
}

export async function recordRewardPayment({
  socialPath,
  fromHandle,
  toHandle,
  fromWallet,
  toWallet,
  amount,
  asset = 'SOL',
  txSignature,
  network = 'devnet',
  rpcUrl,
  note,
  verifyTx = false
}) {
  if (!toWallet) throw new Error('Missing toWallet');
  if (!amount || Number(amount) <= 0) throw new Error('amount must be > 0');
  if (!txSignature) throw new Error('Missing txSignature');

  new PublicKey(toWallet);
  if (fromWallet) new PublicKey(fromWallet);

  const verification = await verifyTransactionIfRequested({
    verifyTx,
    txSignature,
    network,
    rpcUrl
  });

  const paymentId = crypto.randomUUID();
  const timestamp = nowIso();
  const fromKey = fromHandle ? normalizeHandle(fromHandle) : fromWallet || 'unknown';
  const toKey = toHandle ? normalizeHandle(toHandle) : toWallet;

  const payment = {
    id: paymentId,
    fromHandle: fromHandle ? normalizeHandle(fromHandle) : null,
    toHandle: toHandle ? normalizeHandle(toHandle) : null,
    fromWallet: fromWallet || null,
    toWallet,
    amount: Number(amount),
    asset,
    txSignature,
    network,
    note: note || null,
    timestamp,
    ...verification
  };

  const paymentsPath = path.join(socialPath, PAYMENTS_FILE);
  const payments = await readJson(paymentsPath, []);
  payments.push(payment);
  await writeJson(paymentsPath, payments);

  const edgesPath = path.join(socialPath, 'edges.json');
  const edges = await readJson(edgesPath, []);
  edges.push({
    from: fromKey,
    to: toKey,
    type: 'payment',
    amount: Number(amount),
    asset,
    txSignature,
    source: 'solana',
    timestamp
  });
  await writeJson(edgesPath, edges);

  return payment;
}

export async function getWalletBindingStatus({ socialPath, handle }) {
  const normalizedHandle = normalizeHandle(handle);
  const nodesPath = path.join(socialPath, 'nodes.json');
  const nodes = await readJson(nodesPath, []);
  const node = nodes.find((n) => n.handle === normalizedHandle || getNodeKey(n) === normalizedHandle);
  if (!node) return { exists: false, handle: normalizedHandle };
  return {
    exists: true,
    handle: normalizedHandle,
    walletAddress: node.walletAddress || node.meta?.walletAddress || null,
    walletVerifiedAt: node.walletVerifiedAt || node.meta?.walletVerifiedAt || null,
    trustScoreOnchain: Number(node.trustScoreOnchain || 0)
  };
}
