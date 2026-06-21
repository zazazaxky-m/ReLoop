import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class PickupScreen extends StatefulWidget {
  const PickupScreen({super.key});

  @override
  State<PickupScreen> createState() => _PickupScreenState();
}

class _PickupScreenState extends State<PickupScreen> {
  List<dynamic> _pickups = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadPickups();
  }

  Future<void> _loadPickups() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      final auth = context.read<AuthProvider>();
      final queryParams = <String, String>{};
      if (auth.user?.role == AppRole.PENGEPUL) {
        queryParams['scope'] = 'available';
      }
      final response = await api.get('/api/pickups', queryParameters: queryParams);
      final data = response.data as Map<String, dynamic>;
      setState(() {
        _pickups = (data['pickups'] as List? ?? []).cast<dynamic>();
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  Future<void> _updatePickupStatus(String pickupId, String action) async {
    try {
      final api = context.read<ApiClient>();
      await api.patch('/api/pickups/$pickupId', data: {'action': action});
      await _loadPickups();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Gagal memperbarui status')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final isCollector = auth.user?.role == AppRole.PENGEPUL;

    return Scaffold(
      appBar: AppBar(
        title: Text(isCollector ? 'Tugas Pickup' : 'Pickup'),
      ),
      body: RefreshIndicator(
        onRefresh: _loadPickups,
        child: _buildBody(isCollector),
      ),
    );
  }

  Widget _buildBody(bool isCollector) {
    if (_isLoading) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          SkeletonListTile(),
          SizedBox(height: 8),
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
            const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft),
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: ReLoopColors.muted)),
            const SizedBox(height: 12),
            TextButton(onPressed: _loadPickups, child: const Text('Coba Lagi')),
          ],
        ),
      );
    }

    if (_pickups.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: 80),
          const Center(
            child: Column(
              children: [
                Icon(Icons.local_shipping_outlined,
                    size: 48, color: ReLoopColors.mutedSoft),
                SizedBox(height: 12),
                Text(
                  'Belum ada tugas pickup',
                  style: TextStyle(color: ReLoopColors.mutedSoft, fontSize: 14),
                ),
              ],
            ),
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: _pickups.map((p) {
        final pickup = p as Map<String, dynamic>;
        final machine = pickup['machine'] as Map<String, dynamic>?;
        final org = pickup['organization'] as Map<String, dynamic>?;
        final status = pickup['status'] as String? ?? 'REQUESTED';
        final reason = pickup['reason'] as String? ?? 'MANUAL';
        final priority = (pickup['priority'] as num?)?.toInt() ?? 0;
        final items = (pickup['_count']?['items'] as num?)?.toInt() ?? 0;

        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: ReLoopCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: ReLoopColors.mintSoft,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.local_shipping,
                          color: ReLoopColors.brand500, size: 22),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            machine?['name'] as String? ?? 'Mesin #${pickup['machineId']}',
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                              color: ReLoopColors.foreground,
                              fontSize: 14,
                            ),
                          ),
                          if (org != null)
                            Text(
                              org['name'] as String? ?? '',
                              style: const TextStyle(
                                color: ReLoopColors.mutedSoft,
                                fontSize: 12,
                              ),
                            ),
                        ],
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        StatusBadge(statusKey: status),
                        if (priority > 0)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: ReLoopColors.statusError.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                'P$priority',
                                style: const TextStyle(
                                  color: ReLoopColors.statusError,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _pickupChip(Icons.info_outline, _reasonLabel(reason)),
                    const SizedBox(width: 6),
                    _pickupChip(Icons.inventory_2, '$items material'),
                    if (machine?['fillLevelPercent'] != null) ...[
                      const SizedBox(width: 6),
                      _pickupChip(
                        Icons.water_drop,
                        '${machine!['fillLevelPercent']}% penuh',
                      ),
                    ],
                  ],
                ),
                if (isCollector) ...[
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      if (status == 'ASSIGNED')
                        Expanded(
                          child: ReLoopButton(
                            label: 'Mulai Perjalanan',
                            icon: Icons.play_arrow,
                            variant: ReLoopButtonVariant.primary,
                            size: ReLoopButtonSize.sm,
                            onPressed: () => _updatePickupStatus(
                                pickup['id'] as String, 'start'),
                          ),
                        ),
                      if (status == 'ON_THE_WAY')
                        Expanded(
                          child: ReLoopButton(
                            label: 'Tiba',
                            icon: Icons.location_on,
                            variant: ReLoopButtonVariant.primary,
                            size: ReLoopButtonSize.sm,
                            onPressed: () => _updatePickupStatus(
                                pickup['id'] as String, 'arrive'),
                          ),
                        ),
                      if (status == 'ARRIVED')
                        Expanded(
                          child: ReLoopButton(
                            label: 'Ambil Sampah',
                            icon: Icons.inventory_2,
                            variant: ReLoopButtonVariant.primary,
                            size: ReLoopButtonSize.sm,
                            onPressed: () => _updatePickupStatus(
                                pickup['id'] as String, 'collect'),
                          ),
                        ),
                      if (status == 'COLLECTED')
                        Expanded(
                          child: ReLoopButton(
                            label: 'Selesai',
                            icon: Icons.check,
                            variant: ReLoopButtonVariant.primary,
                            size: ReLoopButtonSize.sm,
                            onPressed: () => _updatePickupStatus(
                                pickup['id'] as String, 'complete'),
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _pickupChip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: ReLoopColors.background,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: ReLoopColors.mutedSoft),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              fontSize: 11,
              color: ReLoopColors.muted,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  String _reasonLabel(String reason) {
    switch (reason) {
      case 'FULL':
        return 'Penuh';
      case 'SCHEDULED':
        return 'Terjadwal';
      case 'MANUAL':
        return 'Manual';
      case 'ERROR':
        return 'Error';
      default:
        return reason;
    }
  }
}
