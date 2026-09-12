# Task 01 POS

React/Vite POS interface backed by Express. The backend reserves inventory before payment and has PostgreSQL transactions for production.

## Run

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

Set `VITE_API_URL` when the API is deployed somewhere other than `http://localhost:4001/api`.

## Test manually

Add products, reserve checkout, approve/fail/timeout payment, refresh inventory, and run `cd backend && npm test` to exercise concurrent reservations.
