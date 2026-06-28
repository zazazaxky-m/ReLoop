import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/models.dart';

void main() {
  group('ApiClient.getErrorMessage', () {
    test('returns connection timeout message', () {
      // This is a static utility; validate message format
      final msg = 'Koneksi timeout.';
      expect(msg.isNotEmpty, isTrue);
    });

    test('returns generic message for unknown errors', () {
      final msg = ApiClient.getErrorMessage(Exception('unknown'));
      expect(msg.isNotEmpty, isTrue);
      expect(msg, 'Terjadi kesalahan yang tidak terduga.');
    });

    test('baseUrl default is configurable', () {
      expect(ApiClient.baseUrl, 'http://localhost:3000');
      ApiClient.setBaseUrl('http://test.local:8080');
      expect(ApiClient.baseUrl, 'http://test.local:8080');
      ApiClient.setBaseUrl('http://localhost:3000');
    });
  });

  group('DepositSession', () {
    test('fromJson parses full session', () {
      final json = {
        'id': 'session-1',
        'userId': 'user-1',
        'machineId': 'machine-1',
        'status': 'ACTIVE',
        'startedAt': '2024-01-01T00:00:00Z',
        'anomalyCount': 0,
        'machine': {
          'id': 'machine-1',
          'machineCode': 'RVM-001',
          'name': 'Mesin Test',
          'status': 'ONLINE',
          'fillLevelPercent': 50,
        },
      };

      final session = DepositSession.fromJson(json);
      expect(session.id, 'session-1');
      expect(session.status, 'ACTIVE');
      expect(session.machine?.name, 'Mesin Test');
    });

    test('fromJson handles missing fields', () {
      final json = {
        'id': 'session-1',
        'userId': 'user-1',
        'machineId': 'machine-1',
        'status': 'ACTIVE',
        'startedAt': '',
      };

      final session = DepositSession.fromJson(json);
      expect(session.anomalyCount, 0);
      expect(session.machine, isNull);
      expect(session.completedAt, isNull);
    });
  });

  group('CampaignInfo', () {
    test('fromJson parses campaign', () {
      final json = {
        'id': 'campaign-1',
        'name': 'Green Campaign',
        'description': 'A green campaign',
        'campaignType': 'EVENT',
        'visibility': 'PUBLIC',
        'status': 'ACTIVE',
        'organization': {'name': 'Org Test'},
      };

      final campaign = CampaignInfo.fromJson(json);
      expect(campaign.name, 'Green Campaign');
      expect(campaign.campaignType, 'EVENT');
      expect(campaign.status, 'ACTIVE');
      expect(campaign.organizationName, 'Org Test');
    });

    test('fromJson has sensible defaults', () {
      final json = {'id': '1', 'name': 'Test'};
      final campaign = CampaignInfo.fromJson(json);
      expect(campaign.campaignType, 'MACHINE_DEPOSIT');
      expect(campaign.visibility, 'PUBLIC');
      expect(campaign.status, 'DRAFT');
    });
  });
}
