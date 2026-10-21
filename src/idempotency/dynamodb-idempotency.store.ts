import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { BeginResult, IdempotencyStore } from './Idempotency.store';


export class DynamoIdempotencyStore implements IdempotencyStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client: DynamoDBClient = new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT || undefined }),
  ) {
    this.doc = DynamoDBDocumentClient.from(client);
  }

  async begin(key: string, lockMs: number): Promise<BeginResult> {
    const now = Date.now();
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: { id: key, status: 'IN_PROGRESS', expiresAt: Math.ceil((now + lockMs) / 1000) },
          ConditionExpression: 'attribute_not_exists(#id) OR #exp < :nowSec',
          ExpressionAttributeNames: { '#id': 'id', '#exp': 'expiresAt' },
          ExpressionAttributeValues: { ':nowSec': Math.floor(now / 1000) },
        }),
      );
      return 'acquired';
    } catch (err: any) {
      if (err?.name !== 'ConditionalCheckFailedException') throw err;
      const { Item } = await this.doc.send(
        new GetCommand({ TableName: this.table, Key: { id: key }, ConsistentRead: true }),
      );
      return Item?.status === 'COMPLETED' ? 'completed' : 'in_progress';
    }
  }

  async complete(key: string, retentionMs: number): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { id: key },
        UpdateExpression: 'SET #st = :done, #exp = :exp',
        ExpressionAttributeNames: { '#st': 'status', '#exp': 'expiresAt' },
        ExpressionAttributeValues: { ':done': 'COMPLETED', ':exp': Math.ceil((Date.now() + retentionMs) / 1000) },
      }),
    );
  }

  async release(key: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { id: key } }));
  }
}