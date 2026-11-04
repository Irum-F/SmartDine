import mongoose from 'mongoose';

export async function connectDb(uri, logger) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  logger.info('Connected to MongoDB');
}

export function dbReady() {
  return mongoose.connection.readyState === 1;
}