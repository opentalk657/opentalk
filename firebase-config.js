// 1) Va sur Firebase Console → Project settings → Web app → config
// 2) Colle la config ci-dessous (remplace le contenu de firebaseConfig)
const const firebaseConfig = {
  apiKey: "TA_CLE_API",
  authDomain: "opentalk-63f66.firebaseapp.com",
  projectId: "opentalk-63f66",
  storageBucket: "opentalk-63f66.appspot.com",
  messagingSenderId: "29397101514",
  appId: "1:29397101514:web:1acb0e38c02c682f4cbd33"
};


firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
