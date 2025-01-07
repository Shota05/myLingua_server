// lib/mongodb.ts
import { MongoClient, ServerApiVersion } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("Please add your Mongo URI to .env");
}

// グローバル空間にキャッシュするための型拡張
let globalForMongo = global as unknown as {
  mongoClientPromise: Promise<MongoClient>;
};

// 開発環境ではホットリロード時に毎回クライアントを新しく作り直さないようにする
let client: MongoClient;
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  // 開発環境
  if (!globalForMongo.mongoClientPromise) {
    client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    globalForMongo.mongoClientPromise = client.connect();
  }
  clientPromise = globalForMongo.mongoClientPromise;
} else {
  // 本番環境
  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  clientPromise = client.connect();
}

// この clientPromise を、各 API ルートから使う
export default clientPromise;
