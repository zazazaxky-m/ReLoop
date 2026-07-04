import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'admin_shell.dart';

class AdminComplianceScreen extends StatefulWidget {
  const AdminComplianceScreen({super.key});

  @override
  State<AdminComplianceScreen> createState() => _AdminComplianceScreenState();
}

class _AdminComplianceScreenState extends State<AdminComplianceScreen> {
  List<dynamic> _trips = [];
  List<dynamic> _agents = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final results = await Future.wait([
        api.get('/api/trips'),
        api.get('/api/travel-agents'),
      ]);
      setState(() {
        _trips =
            (((results[0].data as Map)['trips']) as List?)?.cast<dynamic>() ??
            [];
        _agents =
            (((results[1].data as Map)['agents']) as List?)?.cast<dynamic>() ??
            [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  int get _totalTrips => _trips.length;
  int get _compliantTrips =>
      _trips.where((t) => t['complianceStatus'] == 'COMPLIANT').length;
  int get _reviewTrips =>
      _trips.where((t) => t['complianceStatus'] == 'NEEDS_REVIEW').length;
  int get _nonCompliantTrips =>
      _trips.where((t) => t['complianceStatus'] == 'NON_COMPLIANT').length;

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Compliance Wisata',
      child: RefreshIndicator(onRefresh: _load, child: _buildBody()),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          SkeletonListTile(),
          SizedBox(height: 8),
          SkeletonListTile(),
        ],
      );
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, size: 48, color: context.reloopMutedSoft),
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: context.reloopMuted)),
            TextButton(onPressed: _load, child: Text('Coba Lagi')),
          ],
        ),
      );
    }

    final rows = _agents.map((item) {
      final agent = item as Map<String, dynamic>;
      final tripCount = (agent['tripCount'] as num?)?.toInt() ?? 0;
      final compliantCount = (agent['compliantCount'] as num?)?.toInt() ?? 0;
      final nonCompliantCount =
          (agent['nonCompliantCount'] as num?)?.toInt() ?? 0;
      final reviewCount = tripCount - compliantCount - nonCompliantCount;
      final rate = tripCount > 0
          ? ((compliantCount / tripCount) * 100).round()
          : 0;
      final status = tripCount == 0
          ? 'NOT_STARTED'
          : nonCompliantCount > 0
          ? 'NON_COMPLIANT'
          : reviewCount > 0
          ? 'NEEDS_REVIEW'
          : 'COMPLIANT';
      return {
        'name': agent['name'],
        'email': agent['email'],
        'tripCount': tripCount,
        'compliantCount': compliantCount,
        'nonCompliantCount': nonCompliantCount,
        'reviewCount': reviewCount < 0 ? 0 : reviewCount,
        'rate': rate,
        'status': status,
      };
    }).toList();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(
              child: MetricCard(
                label: 'Total Trip',
                value: _totalTrips.toString(),
                icon: Icons.groups_outlined,
                tone: MetricTone.blue,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: MetricCard(
                label: 'Trip Patuh',
                value: _compliantTrips.toString(),
                icon: Icons.check_circle_outline,
                tone: MetricTone.green,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: MetricCard(
                label: 'Perlu Review',
                value: _reviewTrips.toString(),
                icon: Icons.rule_folder_outlined,
                tone: MetricTone.amber,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: MetricCard(
                label: 'Tidak Patuh',
                value: _nonCompliantTrips.toString(),
                icon: Icons.warning_amber_rounded,
                tone: MetricTone.amber,
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (rows.isEmpty)
          SizedBox(
            height: 160,
            child: Center(
              child: Text(
                'Belum ada data compliance.',
                style: TextStyle(color: context.reloopMutedSoft),
              ),
            ),
          )
        else
          ...rows.map((row) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ReLoopCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                (row['name'] as String?) ?? 'Travel Agent',
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 14,
                                  color: context.reloopForeground,
                                ),
                              ),
                              if (row['email'] != null)
                                Text(
                                  row['email'] as String,
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: context.reloopMutedSoft,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        StatusBadge(
                          statusKey: row['status'] as String? ?? 'NOT_STARTED',
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        _chip('${row['tripCount']} trip'),
                        _chip('${row['rate']}% patuh'),
                        _chip('${row['compliantCount']} compliant'),
                        if ((row['reviewCount'] as int) > 0)
                          _chip('${row['reviewCount']} review'),
                        if ((row['nonCompliantCount'] as int) > 0)
                          _chip('${row['nonCompliantCount']} tidak patuh'),
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),
        const SizedBox(height: 80),
      ],
    );
  }

  Widget _chip(String label) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: context.reloopSurfaceSoft,
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(
      label,
      style: TextStyle(
        fontSize: 10,
        color: context.reloopMuted,
        fontWeight: FontWeight.w500,
      ),
    ),
  );
}
