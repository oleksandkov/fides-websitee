const { MongoClient } = require("mongodb");

exports.handler = async function (event, context) {
  const uri = process.env.MONGO_URI;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    // Example: list databases
    const databases = await client.db().admin().listDatabases();
    return {
      statusCode: 200,
      body: JSON.stringify({ databases }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  } finally {
    await client.close();
  }
};
