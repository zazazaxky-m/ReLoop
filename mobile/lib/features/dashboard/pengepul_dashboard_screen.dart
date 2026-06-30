import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/promo_carousel.dart';
import '../../shared/widgets/quick_action.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class PengepulDashboardScreen extends StatefulWidget {
  const PengepulDashboardScreen({super.key});

  @override
  State<PengepulDashboardScreen> createState() =>
      _PengepulDashboardScreenState();
}

class _PengepulDashboardScreenState extends State<PengepulDashboardScreen> {
  int _activeTasks = 0;
  int _activePartners = 0;
  int _fullMachines = 0;
  List<dynamic> _tasks = [];
  List<dynamic> _machines = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadDashboard();
  }

  Future<void> _loadDashboard() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();

      final results = await Future.wait([
        api.get('/api/pickups', queryParameters: {'scope': 'collector'}),
        api.get('/api/public/machines', queryParameters: {'scope': 'partners'}),
        api.get('/api/partnerships', queryParameters: {'status': 'ACTIVE'}),
      ]);

      final pickupsData = results[0].data as Map<String, dynamic>;
      final machinesData = results[1].data as Map<String, dynamic>;
      final partnershipsData = results[2].data;

      final pickups = (pickupsData['pickups'] as List? ?? []).cast<dynamic>();
      final machines = (machinesData['machines'] as List? ?? [])
          .cast<dynamic>();
      final partnerships =
          (partnershipsData is Map
                  ? (partnershipsData['partnerships'] as List? ?? [])
                  : [])
              .cast<dynamic>();

      setState(() {
        _activeTasks = pickups.where((p) {
          final status = (p as Map<String, dynamic>)['status'] as String? ?? '';
          return !['COMPLETED', 'CANCELLED', 'FAILED'].contains(status);
        }).length;
        _fullMachines = machines.where((m) {
          return (m as Map<String, dynamic>)['status'] == 'FULL';
        }).length;
        _activePartners = partnerships.where((p) {
          return (p as Map<String, dynamic>)['status'] == 'ACTIVE';
        }).length;
        _tasks = pickups;
        _machines = machines;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RefreshIndicator(onRefresh: _loadDashboard, child: _buildBody()),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          SkeletonListTile(),
          SizedBox(height: 16),
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
            const SizedBox(height: 12),
            TextButton(onPressed: _loadDashboard, child: Text('Coba Lagi')),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
      children: [
        const PromoCarousel(),
        const SizedBox(height: 18),
        Text(
          'Pantau tugas pengambilan dan mesin yang membutuhkan penanganan.',
          style: TextStyle(fontSize: 13, color: context.reloopMuted),
        ),
        const SizedBox(height: 16),

        Row(
          children: [
            Expanded(
              flex: 2,
              child: MetricCard(
                label: 'Tugas aktif',
                value: _activeTasks.toString(),
                icon: Icons.local_shipping,
                tone: MetricTone.amber,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: MetricCard(
                label: 'Mitra aktif',
                value: _activePartners.toString(),
                icon: Icons.location_on_outlined,
                tone: MetricTone.teal,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        MetricCard(
          label: 'Mesin penuh',
          value: _fullMachines.toString(),
          icon: Icons.recycling,
          tone: MetricTone.blue,
        ),

        const SizedBox(height: 24),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: 1.6,
          children: [
            QuickAction(
              icon: Icons.local_shipping_outlined,
              title: 'Tugas Pickup',
              description: 'Lihat tugas',
              tone: QuickActionTone.amber,
              onTap: () => context.push('/pickup'),
            ),
            QuickAction(
              icon: Icons.map_outlined,
              title: 'Peta Mesin',
              description: 'Cari mesin',
              tone: QuickActionTone.blue,
              onTap: () => context.push('/map'),
            ),
            QuickAction(
              icon: Icons.location_on_outlined,
              title: 'Area Layanan',
              description: 'Kelola mitra',
              tone: QuickActionTone.teal,
              onTap: () => context.push('/pengepul/area'),
            ),
            QuickAction(
              icon: Icons.person_outline,
              title: 'Profil',
              description: 'Info kontak',
              tone: QuickActionTone.green,
              onTap: () => context.push('/profile'),
            ),
          ],
        ),

        const SizedBox(height: 24),
        _buildSectionHeader('Tugas pickup'),
        const SizedBox(height: 8),
        ..._buildTaskList(),

        const SizedBox(height: 24),
        _buildSectionHeader('Mesin penuh dari mitra'),
        const SizedBox(height: 8),
        ..._buildMachineList(),

        const SizedBox(height: 80),
      ],
    );
  }

  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: context.reloopForeground,
      ),
    );
  }

  List<Widget> _buildTaskList() {
    if (_tasks.isEmpty) {
      return [
        Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: Center(
            child: Text(
              'Tidak ada tugas pickup saat ini.',
              style: TextStyle(color: context.reloopMutedSoft, fontSize: 13),
            ),
          ),
        ),
      ];
    }

    return _tasks.take(5).map((t) {
      final task = t as Map<String, dynamic>;
      final machine = task['machine'] as Map<String, dynamic>?;
      final org = task['organization'] as Map<String, dynamic>?;
      final status = task['status'] as String? ?? 'REQUESTED';

      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: ReLoopCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      machine?['name'] as String? ??
                          org?['name'] as String? ??
                          'Mesin',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                        color: context.reloopForeground,
                      ),
                    ),
                  ),
                  StatusBadge(statusKey: status),
                ],
              ),
              if (org != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Row(
                    children: [
                      Text(
                        org['name'] as String? ?? '',
                        style: TextStyle(
                          fontSize: 11,
                          color: context.reloopMutedSoft,
                        ),
                      ),
                      if (org['contactPhone'] != null) ...[
                        Text(
                          '  -  ',
                          style: TextStyle(
                            fontSize: 11,
                            color: context.reloopMutedSoft,
                          ),
                        ),
                        Text(
                          org['contactPhone'] as String,
                          style: TextStyle(
                            fontSize: 11,
                            color: context.reloopMutedSoft,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
            ],
          ),
        ),
      );
    }).toList();
  }

  List<Widget> _buildMachineList() {
    final fullList = _machines.where((m) {
      return (m as Map<String, dynamic>)['status'] == 'FULL';
    }).toList();

    if (fullList.isEmpty) {
      return [
        Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: Center(
            child: Text(
              'Tidak ada mesin penuh.',
              style: TextStyle(color: context.reloopMutedSoft, fontSize: 13),
            ),
          ),
        ),
      ];
    }

    return fullList.take(5).map((m) {
      final machine = m as Map<String, dynamic>;
      final org = machine['organization'] as Map<String, dynamic>?;
      final fillLevel = machine['fillLevelPercent'] as num? ?? 0;

      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: ReLoopCard(
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      machine['name'] as String? ?? 'Mesin',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                        color: context.reloopForeground,
                      ),
                    ),
                    if (org != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Row(
                          children: [
                            Text(
                              org['name'] as String? ?? '',
                              style: TextStyle(
                                fontSize: 11,
                                color: context.reloopMutedSoft,
                              ),
                            ),
                            Text(
                              '  -  ',
                              style: TextStyle(
                                fontSize: 11,
                                color: context.reloopMutedSoft,
                              ),
                            ),
                            Text(
                              '$fillLevel% terisi',
                              style: TextStyle(
                                fontSize: 11,
                                color: context.reloopMutedSoft,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              StatusBadge(statusKey: machine['status'] as String? ?? 'FULL'),
            ],
          ),
        ),
      );
    }).toList();
  }
}
