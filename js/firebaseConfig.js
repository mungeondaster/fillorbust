// ---------------------------------------------------------------------------
// Paste your Firebase project's web app config below, then set MULTIPLAYER_ENABLED
// to true. Get this from: Firebase Console -> Project Settings -> General ->
// "Your apps" -> Web app -> SDK setup and configuration -> Config.
//
// This object is a client identifier, not a secret -- it's normal and safe for
// it to be visible in committed source / browser devtools. Access control comes
// from your Realtime Database security rules (see the setup instructions), not
// from hiding this config.
// ---------------------------------------------------------------------------

export const MULTIPLAYER_ENABLED = false;

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
