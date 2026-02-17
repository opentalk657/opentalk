// 1) Va sur Firebase Console → Project settings → Web app → config
// 2) Colle la config ci-dessous (remplace le contenu de firebaseConfig)
const firebaseConfig = {
  apiKey: "PUT_YOUR_API_KEY",
  authDomain: "PUT_YOUR_AUTH_DOMAIN",
  projectId: "PUT_YOUR_PROJECT_ID",
  storageBucket: "PUT_YOUR_STORAGE_BUCKET",
  messagingSenderId: "PUT_YOUR_SENDER_ID",
  appId: "PUT_YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
