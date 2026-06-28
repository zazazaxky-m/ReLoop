import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class TrashBagScreen extends StatefulWidget {
  const TrashBagScreen({super.key});

  @override
  State<TrashBagScreen> createState() => _TrashBagScreenState();
}

class _TrashBagScreenState extends State<TrashBagScreen> {
  List<Trip> _trips = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadTrips();
  }

  Future<void> _loadTrips() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      final response = await api.get('/api/trips');
      final data = response.data as Map<String, dynamic>;
      setState(() {
        _trips = (data['trips'] as List? ?? [])
            .map((e) => Trip.fromJson(e as Map<String, dynamic>))
            .toList();
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
      appBar: AppBar(title: const Text('Trash Bag / Trip')),
      body: RefreshIndicator(
        onRefresh: _loadTrips,
        child: _buildBody(),
      ),
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
            TextButton(onPressed: _loadTrips, child: const Text('Coba Lagi')),
          ],
        ),
      );
    }

    if (_trips.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: 80),
          Center(
            child: Column(
              children: [
                Icon(Icons.delete_outline, size: 48, color: ReLoopColors.mutedSoft),
                SizedBox(height: 12),
                Text(
                  'Belum ada trip',
                  style: TextStyle(
                      color: context.reloopForeground,
                      fontSize: 16,
                      fontWeight: FontWeight.w700),
                ),
                SizedBox(height: 4),
                Text(
                  'Belum ada penugasan kantong atau perjalanan',
                  style: TextStyle(color: context.reloopMutedSoft, fontSize: 13),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Daftar Rombongan & Kantong',
          style: TextStyle(
            color: context.reloopForeground,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        ..._trips.map((trip) {
          final bagCount = trip.count?.bagAssignments ?? 0;
          final valCount = trip.count?.validations ?? 0;
          final title = trip.groupName ?? trip.campaign?.name ?? 'Rombongan';

          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: ReLoopCard(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: context.reloopForeground,
                            fontSize: 15,
                          ),
                        ),
                      ),
                      StatusBadge(statusKey: trip.status),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${trip.campaign?.name ?? '-'} • ${trip.participantCount} peserta',
                    style: TextStyle(
                      color: context.reloopMuted,
                      fontSize: 13,
                    ),
                  ),
                  if (trip.leaderName != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      'Ketua: ${trip.leaderName}',
                      style: TextStyle(
                        color: context.reloopMutedSoft,
                        fontSize: 12,
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: context.reloopBrandSoft,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Trash Bag QR',
                                style: TextStyle(
                                  color: context.reloopBrandText,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                bagCount > 0
                                    ? '$bagCount kantong'
                                    : 'Belum di-assign',
                                style: TextStyle(
                                  color: bagCount > 0
                                      ? (context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand600)
                                      : context.reloopMuted,
                                  fontSize: 13,
                                  fontWeight: bagCount > 0
                                      ? FontWeight.w700
                                      : FontWeight.normal,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: context.reloopSurfaceSoft,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Validasi Pengembalian',
                                style: TextStyle(
                                  color: context.reloopForeground,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                valCount > 0
                                    ? '$valCount kali validasi'
                                    : 'Belum diverifikasi',
                                style: TextStyle(
                                  color: valCount > 0
                                      ? (context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand600)
                                      : context.reloopMutedSoft,
                                  fontSize: 13,
                                  fontWeight: valCount > 0
                                      ? FontWeight.w700
                                      : FontWeight.normal,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }
}
