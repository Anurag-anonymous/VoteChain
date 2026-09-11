const mongoose = require('mongoose');

const getMongoUri = () => {
  if (process.env.MONGODB_URI) {
    return process.env.MONGODB_URI;
  }

  const mode = (process.env.MONGODB_MODE || 'local').toLowerCase();

  if (mode === 'atlas') {
    return process.env.MONGODB_ATLAS_URI || 'mongodb+srv://username:password@cluster.mongodb.net/voting-app';
  }

  return process.env.MONGODB_LOCAL_URI || 'mongodb://127.0.0.1:27017/voting-app';
};

const connectDB = async () => {
  try {
    const mongoUri = getMongoUri();
    console.log(`Connecting to MongoDB using mode: ${process.env.MONGODB_MODE || 'local'}`);
    console.log(`MongoDB URI: ${mongoUri}`);

    const conn = await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
