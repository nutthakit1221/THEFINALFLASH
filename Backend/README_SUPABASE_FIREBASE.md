# Option A: Firebase Auth + Supabase Storage (Backend Guide)

- Install deps: `cd Backend && npm install`
- Copy `.env.example` to `.env` and fill values
- Put Firebase service account JSON and set GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
- Supabase: create private bucket `user-uploads`, set URL + service role key
- Run: `npm start`
- API: POST `/api/upload-supabase`, `/api/signed-url`
