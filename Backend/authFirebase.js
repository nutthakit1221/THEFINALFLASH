// Backend/authFirebase.js
const admin = require('firebase-admin');
let initialized = false;
function initFirebaseAdmin() {
  if (initialized) return;
  if (admin.apps.length) { initialized = true; return; }
  const saInline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saInline && saInline.trim().startsWith('{')) {
    const serviceAccount = JSON.parse(saInline);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    return;
  }
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  initialized = true;
}
async function verifyFirebaseToken(idToken) {
  initFirebaseAdmin();
  const decoded = await admin.auth().verifyIdToken(idToken);
  return decoded;
}
module.exports = { verifyFirebaseToken };
