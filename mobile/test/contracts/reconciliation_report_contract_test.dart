import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/models.dart';

/// Loads a shared backend<->mobile DTO fixture from tests/fixtures/contracts/
/// (`flutter test` runs from mobile/, so the fixture is one level up).
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
  group('reconciliation-report contract v1', () {
    final document = loadContract('reconciliation-report.v1.json');

    test('fixture is the v1 reconciliation-report contract', () {
      expect(document['contract'], 'reconciliation-report');
      expect(document['version'], 1);
      expect(document['endpoint'], 'GET /api/reports/reconciliation');
    });

    test('ReconciliationLiability.fromJson reads every net figure the backend sends', () {
      final response = document['response'] as Map<String, dynamic>;
      final report = response['report'] as Map<String, dynamic>;
      final overdrawn = report['overdrawn'] as Map<String, dynamic>;
      final mismatches = report['payoutMismatches'] as List<dynamic>;
      final first = mismatches.first as Map<String, dynamic>;

      final liability = ReconciliationLiability.fromJson(report);

      expect(liability.availableLiability, report['availableLiability']);
      expect(liability.pendingLiability, report['pendingLiability']);
      expect(liability.reservedLiability, report['reservedLiability']);
      expect(liability.paidTotal, report['paidTotal']);
      expect(liability.totalObligation, report['totalObligation']);
      expect(
        liability.totalObligation,
        liability.availableLiability +
            liability.reservedLiability +
            liability.pendingLiability,
      );
      expect(liability.unallocatedLegacyAmount, report['unallocatedLegacyAmount']);
      expect(liability.redeemedDiscrepancy, report['redeemedDiscrepancy']);
      expect(liability.reservedDiscrepancy, report['reservedDiscrepancy']);
      expect(liability.hasDiscrepancy, report['hasDiscrepancy']);
      expect(liability.payoutMismatchCount, report['payoutMismatchCount']);
      expect(liability.overdrawnUsers, overdrawn['users']);
      expect(
        liability.overdrawnShortfall,
        (overdrawn['availableShortfall'] as int) +
            (overdrawn['pendingShortfall'] as int),
      );
      expect(liability.payoutMismatches, hasLength(mismatches.length));
      final mismatch = liability.payoutMismatches.first;
      expect(mismatch.redemptionId, first['redemptionId']);
      expect(mismatch.userId, first['userId']);
      expect(mismatch.requestStatus, first['requestStatus']);
      expect(mismatch.requestAmount, first['requestAmount']);
      expect(mismatch.reserveStatuses, first['reserveStatuses']);
      expect(mismatch.paidDifference, first['paidDifference']);
      expect(mismatch.reservedDifference, first['reservedDifference']);
      expect(mismatch.problem, first['problem']);
    });

    test('a server from before M05 falls back to the compatibility alias', () {
      final legacy = ReconciliationLiability.fromJson({
        'totalOutstanding': 60000,
        'totalEarnPending': 5000,
        'ledgerReserved': 15000,
        'ledgerRedeemed': 40000,
        'hasDiscrepancy': false,
      });
      expect(legacy.availableLiability, 60000);
      expect(legacy.pendingLiability, 5000);
      expect(legacy.reservedLiability, 15000);
      expect(legacy.paidTotal, 40000);
      expect(legacy.totalObligation, 80000);
      expect(legacy.unallocatedLegacyAmount, 60000);
      expect(legacy.payoutMismatches, isEmpty);
    });
  });
}
