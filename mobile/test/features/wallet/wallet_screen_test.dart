import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/core/models/redemption.dart';

void main() {
  test('WalletBalance formats values', () {
    final balance = WalletBalance.fromJson({
      'available': 15000,
      'pending': 2000,
      'redeemed': 5000,
      'reserved': 1000,
      'totalEarned': 23000,
    });

    expect(balance.availableFormatted, 'Rp 15.000');
    expect(balance.pendingFormatted, 'Rp 2.000');
    expect(balance.totalEarnedFormatted, 'Rp 23.000');
  });

  test('RewardLedgerEntry reads nested fields and formats amounts', () {
    final entry = RewardLedgerEntry.fromJson({
      'id': 'h1',
      'userId': 'u1',
      'entryType': 'EARN',
      'amount': 5000,
      'status': 'AVAILABLE',
      'createdAt': '2026-07-10T08:00:00Z',
      'depositItem': {
        'wasteType': {'name': 'Plastik'},
        'baseRewardAmount': 6000,
        'complianceMultiplier': 0.8,
      },
      'session': {
        'machine': {'name': 'Mesin A'},
      },
    });

    expect(entry.wasteTypeName, 'Plastik');
    expect(entry.machineName, 'Mesin A');
    expect(entry.baseRewardAmount, 6000);
    expect(entry.complianceMultiplier, 0.8);
    expect(entry.amount, 5000);
  });

  test('PayoutAccount and Redemption parse status fields', () {
    final account = PayoutAccount.fromJson({
      'id': 'a1',
      'provider': 'BCA',
      'accountIdentifier': '1234567890',
      'accountName': 'Farhan',
      'status': 'ACTIVE',
    });
    final redemption = Redemption.fromJson({
      'id': 'r1',
      'amount': 10000,
      'provider': 'BCA',
      'status': 'REQUESTED',
      'createdAt': '2026-07-10T06:00:00Z',
    });

    expect(account.provider, 'BCA');
    expect(account.status, 'ACTIVE');
    expect(redemption.amountFormatted, 'Rp 10.000');
    expect(redemption.statusLabel, 'Menunggu');
  });
}
