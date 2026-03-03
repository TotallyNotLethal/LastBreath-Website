import { docClient } from '@/lib/db';
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

export default async function Page() {
  const response = await docClient.send(new ScanCommand({
    TableName: process.env.DYNAMODB_TABLE_NAME
  }));
  const comments = response.Items ?? [];

  return (
    <main className="main">
      <h1 className="title">Next.js + DynamoDB</h1>

      <div className="container">
        {comments.map((comment) => (
          <div key={String(comment.id)}>
            <p>{String(comment.comment ?? '')}</p>
            <div className="metadata">{String(comment.id ?? '')}</div>
          </div>
         ))}
      </div>
    </main>
  );
}
