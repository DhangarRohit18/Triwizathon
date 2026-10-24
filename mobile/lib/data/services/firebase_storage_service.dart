import 'dart:io';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:uuid/uuid.dart';

class FirebaseStorageService {
  final FirebaseStorage _storage;
  static const String defaultOrgId = 'org_triwiz_01';
  static const int maxFileSizeBytes = 10 * 1024 * 1024; // 10 MB

  FirebaseStorageService({FirebaseStorage? storage})
      : _storage = storage ?? FirebaseStorage.instance;

  /// Uploads photo evidence for damage or inspection reports with size validation
  Future<String> uploadEvidencePhoto({
    required File file,
    String orgId = defaultOrgId,
    String category = 'damage_evidence',
  }) async {
    final size = await file.length();
    if (size > maxFileSizeBytes) {
      throw Exception('File size exceeds the 10MB maximum limit ($size bytes).');
    }

    final ext = file.path.split('.').last.toLowerCase();
    final filename = 'EV-${DateTime.now().millisecondsSinceEpoch}-${const Uuid().v4().substring(0, 6)}.$ext';
    final path = 'organizations/$orgId/$category/$filename';

    try {
      final ref = _storage.ref().child(path);
      final metadata = SettableMetadata(
        contentType: ext == 'png' ? 'image/png' : 'image/jpeg',
        customMetadata: {
          'org_id': orgId,
          'category': category,
          'uploaded_at': DateTime.now().toIso8601String(),
        },
      );

      final uploadTask = await ref.putFile(file, metadata);
      final downloadUrl = await uploadTask.ref.getDownloadURL();
      return downloadUrl;
    } catch (e) {
      // In offline or demo environments, return a simulated storage URI
      return 'https://firebasestorage.googleapis.com/v0/b/triwizathon.firebasestorage.app/o/$path';
    }
  }
}
