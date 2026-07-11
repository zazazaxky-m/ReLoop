import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

  Future<void> _openTripDetail(Trip trip) async {
    try {
      final api = context.read<ApiClient>();
      final response = await api.get('/api/trips/${trip.id}');
      final data = response.data as Map<String, dynamic>;
      final detail = data['trip'] as Map<String, dynamic>? ?? {};
      final bags =
          (detail['bagAssignments'] as List?)?.cast<dynamic>() ?? [];
      final validations =
          (detail['validations'] as List?)?.cast<dynamic>() ?? [];
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (ctx) => DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.65,
          minChildSize: 0.4,
          maxChildSize: 0.92,
          builder: (ctx, scrollController) {
            return ListView(
              controller: scrollController,
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              children: [
                Text(
                  trip.groupName ?? trip.campaign?.name ?? 'Detail Trip',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: context.reloopForeground,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Skor compliance: ${(detail['complianceScore'] as num?)?.toInt() ?? 0}/100',
                  style: TextStyle(color: context.reloopMuted, fontSize: 13),
                ),
                if ((detail['trashBagRewardAmount'] as num?) != null &&
                    ((detail['trashBagRewardAmount'] as num?)?.toInt() ?? 0) > 0) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Reward: Rp ${_formatRp((detail['trashBagRewardAmount'] as num).toInt())}',
                    style: TextStyle(
                      color: context.reloopBrandText,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
                if (validations.any(
                  (v) =>
                      (v as Map<String, dynamic>)['validationStage'] ==
                      'BANK_SAMPAH_PICKUP',
                )) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Sampah sudah dijemput bank sampah',
                    style: TextStyle(
                      color: context.reloopMuted,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Text(
                  'Kantong (${bags.length})',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: context.reloopForeground,
                  ),
                ),
                const SizedBox(height: 8),
                if (bags.isEmpty)
                  Text(
                    'Belum ada kantong yang di-assign.',
                    style: TextStyle(color: context.reloopMutedSoft),
                  )
                else
                  ...bags.map((raw) {
                    final bag = raw as Map<String, dynamic>;
                    final code = (bag['bagQrCode'] as String?) ?? '-';
                    final waste =
                        (bag['wasteType'] as Map<String, dynamic>?)?['name']
                            as String?;
                    final status = bag['status'] as String?;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: ReLoopCard(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 10,
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    code,
                                    style: const TextStyle(
                                      fontFamily: 'monospace',
                                      fontWeight: FontWeight.w700,
                                      fontSize: 13,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    [
                                      waste ?? 'Campuran',
                                      if (status != null)
                                        _bagStatusLabel(status)
                                      else
                                        'Belum divalidasi',
                                    ].join(' · '),
                                    style: TextStyle(
                                      fontSize: 11,
                                      color: context.reloopMutedSoft,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            IconButton(
                              tooltip: 'Salin kode',
                              icon: const Icon(Icons.copy, size: 18),
                              onPressed: () async {
                                await Clipboard.setData(
                                  ClipboardData(text: code),
                                );
                                if (ctx.mounted) {
                                  ScaffoldMessenger.of(ctx).showSnackBar(
                                    SnackBar(
                                      content: Text('Disalin: $code'),
                                      backgroundColor: ReLoopColors.success,
                                    ),
                                  );
                                }
                              },
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                const SizedBox(height: 16),
                Text(
                  'Validasi (${validations.length})',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: context.reloopForeground,
                  ),
                ),
                const SizedBox(height: 8),
                if (validations.isEmpty)
                  Text(
                    'Belum ada validasi.',
                    style: TextStyle(color: context.reloopMutedSoft),
                  )
                else
                  ...validations.map((raw) {
                    final v = raw as Map<String, dynamic>;
                    final stage = (v['validationStage'] as String?) ?? '-';
                    final condition = v['conditionStatus'] as String?;
                    final returned =
                        (v['returnedBagCount'] as num?)?.toInt() ?? 0;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Text(
                        '$stage · $returned tas${condition != null ? ' · ${_bagStatusLabel(condition)}' : ''}',
                        style: TextStyle(
                          fontSize: 12,
                          color: context.reloopMuted,
                        ),
                      ),
                    );
                  }),
              ],
            );
          },
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiClient.getErrorMessage(e)),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    }
  }

  String _bagStatusLabel(String status) {
    switch (status) {
      case 'GOOD':
        return 'Baik';
      case 'PARTIAL':
        return 'Sebagian';
      case 'POOR':
        return 'Rusak';
      case 'NOT_RETURNED':
        return 'Tidak dikembalikan';
      case 'CHECK_IN':
        return 'Check in';
      case 'CHECK_OUT':
        return 'Check out';
      case 'BANK_SAMPAH_PICKUP':
        return 'Pickup bank sampah';
      default:
        return status;
    }
  }

  String _formatRp(int amount) {
    final s = amount.toString();
    final buf = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      final fromEnd = s.length - i;
      buf.write(s[i]);
      if (fromEnd > 1 && fromEnd % 3 == 1) buf.write('.');
    }
    return buf.toString();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Trash Bag / Trip')),
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
            Icon(Icons.cloud_off, size: 48, color: context.reloopMutedSoft),
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: context.reloopMuted)),
            const SizedBox(height: 12),
            TextButton(onPressed: _loadTrips, child: Text('Coba Lagi')),
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
                Icon(Icons.delete_outline, size: 48, color: context.reloopMutedSoft),
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
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                borderRadius: BorderRadius.circular(20),
                onTap: () => _openTripDetail(trip),
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
                  if (trip.complianceStatus != null) ...[
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        StatusBadge(statusKey: trip.complianceStatus!),
                        const SizedBox(width: 8),
                        Text(
                          'Skor ${trip.complianceScore}/100',
                          style: TextStyle(
                            fontSize: 12,
                            color: context.reloopMuted,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ],
                  if (trip.user?.email != null &&
                      trip.campaign?.rewardMode == 'MONEY_REWARD') ...[
                    const SizedBox(height: 4),
                    Text(
                      'Reward: ${trip.user!.email}',
                      style: TextStyle(fontSize: 12, color: context.reloopMutedSoft),
                    ),
                  ],
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
                                        ? '$bagCount kantong · ketuk untuk lihat'
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
              ),
            ),
          );
        }),
      ],
    );
  }
}
