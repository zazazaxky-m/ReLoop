import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/models.dart';

/// Loads a shared backend<->mobile DTO fixture from tests/fixtures/contracts/.
/// `flutter test` runs with the package root (mobile/) as the working
/// directory, so the repository-level fixture is exactly one level up.
Map<String, dynamic> loadContract(String fileName) {
  final file = File.fromUri(
    Directory.current.uri.resolve('../tests/fixtures/contracts/$fileName'),
  );
  if (!file.existsSync()) {
    fail('Contract fixture ${file.path} not found; run `flutter test` from mobile/.');
  }
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

void main() {
  group('scan-session contract v1', () {
    final document = loadContract('scan-session.v1.json');

    test('fixture is the v1 scan-session contract', () {
      expect(document['contract'], 'scan-session');
      expect(document['version'], 1);
      expect(document['endpoint'], 'POST /api/scan');
    });

    test('ScanResult.fromJson reads every field the backend sends', () {
      final response = document['response'] as Map<String, dynamic>;
      final session = response['session'] as Map<String, dynamic>;
      final machine = response['machine'] as Map<String, dynamic>;
      final wasteTypes = machine['supportedWasteTypes'] as List<dynamic>;

      final result = ScanResult.fromJson(response);

      expect(result.resumed, response['resumed']);
      expect(result.session.id, session['id']);
      expect(result.session.userId, session['userId']);
      expect(result.session.machineId, session['machineId']);
      expect(result.session.campaignId, session['campaignId']);
      expect(result.session.status, session['status']);
      expect(result.session.startedAt, session['startedAt']);
      expect(result.session.completedAt, session['completedAt']);
      expect(result.session.timeoutAt, session['timeoutAt']);
      expect(result.session.anomalyCount, session['anomalyCount']);
      expect(result.machine.id, machine['id']);
      expect(result.machine.machineCode, machine['machineCode']);
      expect(result.machine.name, machine['name']);
      expect(result.machine.organizationName, machine['organizationName']);
      expect(result.machine.supportedWasteTypes, hasLength(wasteTypes.length));
      expect(
        result.machine.supportedWasteTypes!.first.id,
        (wasteTypes.first as Map<String, dynamic>)['id'],
      );
      // B01b: the session bound shown before the first item.
      final limits = response['limits'] as Map<String, dynamic>;
      expect(result.limits, isNotNull);
      expect(result.limits!.maxRewardRupiah, limits['maxRewardRupiah']);
      expect(result.limits!.maxItems, limits['maxItems']);
    });
  });
}
