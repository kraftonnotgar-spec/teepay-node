// Verify TeePay webhooks in Express. The route must receive the RAW body.
// Run: npm install express && TEEPAY_WEBHOOK_SECRET=whsec_... node examples/webhook-express.mjs
import express from 'express';
import { verifyWebhook, WebhookVerificationError } from '@teepay/sdk';

const app = express();
const processed = new Set(); // use your database in production

app.post('/webhooks/teepay', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = verifyWebhook(req.body, req.headers, process.env.TEEPAY_WEBHOOK_SECRET);
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.status(400).send('invalid signature');
    throw error;
  }

  if (processed.has(event.id)) return res.sendStatus(200); // retries reuse the same id
  processed.add(event.id);

  switch (event.event) {
    case 'payment.completed':
      console.log('Paid:', event.data.reference, event.data.money);
      break;
    case 'payment.failed':
    case 'payment.expired':
    case 'payment.voided':
      console.log('Not paid:', event.data.reference);
      break;
    default:
      console.log('Event:', event.event);
  }
  res.sendStatus(200);
});

app.listen(4242, () => console.log('Listening on http://localhost:4242/webhooks/teepay'));
