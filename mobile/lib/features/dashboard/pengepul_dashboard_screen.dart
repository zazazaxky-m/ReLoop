import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
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

      if (mounted) {
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
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = ApiClient.getErrorMessage(e);
          _isLoading = false;
        });
      }
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
      return const SkeletonDashboard();
    }

    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 140),
          Icon(
            Icons.cloud_off_rounded,
            size: 48,
            color: context.reloopMutedSoft,
          ),
          const SizedBox(height: 12),
          Text(_error!, textAlign: TextAlign.center),
          TextButton(onPressed: _loadDashboard, child: const Text('Coba lagi')),
        ],
      );
    }

    final user = context.watch<AuthProvider>().user;
    final firstName = (user?.name ?? 'Mitra').split(' ').first;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 110),
      children: [
        const PromoCarousel(),
        const SizedBox(height: 16),
        _CollectorSummary(
          firstName: firstName,
          onProfile: () => context.push('/profile'),
        ),
        const SizedBox(height: 22),
        Text(
          'Akses Cepat',
          style: TextStyle(
            color: context.reloopForeground,
            fontSize: 17,
            fontWeight: FontWeight.w800,
            letterSpacing: -.2,
          ),
        ),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 4,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 0,
          crossAxisSpacing: 8,
          childAspectRatio: .78,
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
        Text(
          'Ringkasan Operasional',
          style: TextStyle(
            color: context.reloopForeground,
            fontSize: 17,
            fontWeight: FontWeight.w800,
            letterSpacing: -.2,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
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
        _SectionTitle(
          title: 'Tugas pickup terbaru',
          action: 'Lihat semua',
          onAction: () => context.push('/pickup'),
        ),
        const SizedBox(height: 10),
        ..._buildTaskList(),
        const SizedBox(height: 22),
        _SectionTitle(
          title: 'Mesin penuh dari mitra',
          action: 'Lihat peta',
          onAction: () => context.push('/map'),
        ),
        const SizedBox(height: 10),
        ..._buildMachineList(),
      ],
    );
  }

  List<Widget> _buildTaskList() {
    if (_tasks.isEmpty) {
      return const [_EmptyRow('Belum ada tugas pickup saat ini.')];
    }

    return _tasks.take(4).map((t) {
      final task = t as Map<String, dynamic>;
      final machine = task['machine'] as Map<String, dynamic>?;
      final org = task['organization'] as Map<String, dynamic>?;
      final status = task['status'] as String? ?? 'REQUESTED';

      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: ReLoopCard(
          child: Row(
            children: [
              const _ActivityIcon(
                icon: Icons.local_shipping_rounded,
                tone: QuickActionTone.amber,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      machine?['name'] as String? ??
                          org?['name'] as String? ??
                          'Mesin',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      org?['name'] as String? ?? 'Lokasi',
                      style: TextStyle(
                        color: context.reloopMuted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              StatusBadge(statusKey: status),
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
      return const [_EmptyRow('Tidak ada mesin penuh saat ini.')];
    }

    return fullList.take(4).map((m) {
      final machine = m as Map<String, dynamic>;
      final org = machine['organization'] as Map<String, dynamic>?;
      final fillLevel = machine['fillLevelPercent'] as num? ?? 0;

      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: ReLoopCard(
          child: Row(
            children: [
              const _ActivityIcon(
                icon: Icons.recycling_rounded,
                tone: QuickActionTone.blue,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      machine['name'] as String? ?? 'Mesin',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      org?['name'] as String? ?? 'Mitra',
                      style: TextStyle(
                        color: context.reloopMuted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: ReLoopColors.danger.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  '$fillLevel%',
                  style: const TextStyle(
                    color: ReLoopColors.danger,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }).toList();
  }
}

class _CollectorSummary extends StatelessWidget {
  const _CollectorSummary({
    required this.firstName,
    required this.onProfile,
  });

  final String firstName;
  final VoidCallback onProfile;

  @override
  Widget build(BuildContext context) {
    return ReLoopCard(
      padding: const EdgeInsets.fromLTRB(16, 15, 12, 15),
      child: Row(
        children: [
          InkWell(
            onTap: onProfile,
            borderRadius: BorderRadius.circular(20),
            child: CircleAvatar(
              radius: 23,
              backgroundColor: context.reloopBrandSoftStrong,
              child: Text(
                firstName.isEmpty ? '?' : firstName[0].toUpperCase(),
                style: TextStyle(
                  color: context.reloopBrandText,
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: InkWell(
              onTap: onProfile,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Halo, $firstName!',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -.3,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Siap untuk mengambil sampah hari ini?',
                    style: TextStyle(
                      color: context.reloopMuted,
                      fontSize: 10.5,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.action, this.onAction});

  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: TextStyle(
              color: context.reloopForeground,
              fontSize: 16,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        if (action != null)
          TextButton(onPressed: onAction, child: Text(action!)),
      ],
    );
  }
}

class _ActivityIcon extends StatelessWidget {
  const _ActivityIcon({required this.icon, required this.tone});

  final IconData icon;
  final QuickActionTone tone;

  @override
  Widget build(BuildContext context) {
    final (color, softColor) = switch (tone) {
      QuickActionTone.green => (
          context.reloopBrandText,
          context.reloopBrandSoft,
        ),
      QuickActionTone.blue => (
          context.isDarkMode ? const Color(0xFF93C5FD) : ReLoopColors.info,
          context.isDarkMode ? const Color(0xFF172D49) : const Color(0xFFEDF5FF),
        ),
      QuickActionTone.amber => (
          context.isDarkMode ? const Color(0xFFFCD34D) : ReLoopColors.warning,
          context.isDarkMode ? const Color(0xFF3E2B18) : const Color(0xFFFFF5E7),
        ),
      QuickActionTone.teal => (
          context.isDarkMode ? const Color(0xFF5EEAD4) : const Color(0xFF159A91),
          context.isDarkMode ? const Color(0xFF173936) : const Color(0xFFEAF9F7),
        ),
    };
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: softColor,
        borderRadius: BorderRadius.circular(13),
      ),
      child: Icon(icon, color: color, size: 20),
    );
  }
}

class _EmptyRow extends StatelessWidget {
  const _EmptyRow(this.message);
  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Center(
        child: Text(
          message,
          style: TextStyle(color: context.reloopMuted, fontSize: 12),
        ),
      ),
    );
  }
}
