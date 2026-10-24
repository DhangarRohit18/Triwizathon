// File generated for StockPilot AI Mobile using project 'triwizathon'
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// Default [FirebaseOptions] for StockPilot AI
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        return android;
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyAqoObWgdeCrFgmQGwmzK6WtRXbDPrx5K4',
    appId: '1:945748098990:web:1baa5069453b1d8d28123f',
    messagingSenderId: '945748098990',
    projectId: 'triwizathon',
    authDomain: 'triwizathon.firebaseapp.com',
    storageBucket: 'triwizathon.firebasestorage.app',
    measurementId: 'G-WXQD34J2K4',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyAqoObWgdeCrFgmQGwmzK6WtRXbDPrx5K4',
    appId: '1:945748098990:android:3b29c5a17682e0a2',
    messagingSenderId: '945748098990',
    projectId: 'triwizathon',
    storageBucket: 'triwizathon.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyAqoObWgdeCrFgmQGwmzK6WtRXbDPrx5K4',
    appId: '1:945748098990:ios:8c27d4b17682e0a3',
    messagingSenderId: '945748098990',
    projectId: 'triwizathon',
    storageBucket: 'triwizathon.firebasestorage.app',
  );
}
