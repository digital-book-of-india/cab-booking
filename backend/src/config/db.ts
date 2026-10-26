import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import type { Env } from './env';

export function mongoOptions(env: Pick<Env, 'NODE_ENV' | 'MONGO_MAX_POOL_SIZE'>) {
  return {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: env.MONGO_MAX_POOL_SIZE,
    retryWrites: true,
    w: 'majority' as const,
    journal: true,
    autoIndex: env.NODE_ENV !== 'production',
  };
}

export async function connectMongo(env: Env): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  return mongoose.connect(env.MONGODB_URI, mongoOptions(env));
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

export async function pingMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    throw new Error('mongo not connected');
  }
  await mongoose.connection.db.admin().ping();
}

export function createRedis(env: Env): Redis | null {
  if (!env.REDIS_URL) return null;
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
  });
}
