import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/models/trip.dart';

void main() {
  test('Trip.fromJson parses correctly', () {
    final json = {
      'id': 'trip_1',
      'campaignId': 'camp_1',
      'groupName': 'Team A',
      'participantCount': 5,
      'status': 'ACTIVE',
      'createdAt': '2023-01-01T00:00:00Z',
      'campaign': {
        'id': 'camp_1',
        'name': 'Clean Up',
        'organizationId': 'org_1'
      },
      '_count': {
        'bagAssignments': 10,
        'validations': 2
      }
    };

    final trip = Trip.fromJson(json);

    expect(trip.id, 'trip_1');
    expect(trip.campaignId, 'camp_1');
    expect(trip.groupName, 'Team A');
    expect(trip.leaderName, isNull);
    expect(trip.participantCount, 5);
    expect(trip.status, 'ACTIVE');
    expect(trip.createdAt, '2023-01-01T00:00:00Z');
    expect(trip.campaign, isNotNull);
    expect(trip.campaign!.name, 'Clean Up');
    expect(trip.count, isNotNull);
    expect(trip.count!.bagAssignments, 10);
  });

  test('Trip.fromJson handles missing optional fields gracefully', () {
    final json = {
      'id': 'trip_2',
      'campaignId': 'camp_2',
    };

    final trip = Trip.fromJson(json);

    expect(trip.id, 'trip_2');
    expect(trip.participantCount, 1); // default value
    expect(trip.status, 'PLANNED'); // default value
    expect(trip.createdAt, ''); // default value
    expect(trip.campaign, isNull);
    expect(trip.count, isNull);
  });
}
