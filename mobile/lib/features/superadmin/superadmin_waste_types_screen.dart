import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/search_bar.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import '../admin/admin_shell.dart';

/// Layar khusus superadmin untuk melihat jenis sampah & tarif.
/// Menampilkan info nama organisasi, jumlah deposit, dan nama campaign
/// untuk setiap rate (informasi yang hanya relevan untuk superadmin).
class SuperadminWasteTypesScreen extends StatefulWidget {
  const SuperadminWasteTypesScreen({super.key});

  @override
  State<SuperadminWasteTypesScreen> createState() =>
      _SuperadminWasteTypesScreenState();
}

class _SuperadminWasteTypesScreenState
    extends State<SuperadminWasteTypesScreen> {
  List<dynamic> _wasteTypes = [];
  List<dynamic> _rates = [];
  List<dynamic> _campaigns = [];
  String? _error;
  String _query = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final results = await Future.wait([
        api.get('/api/waste-types'),
        api.get('/api/reward-rates'),
        api.get('/api/campaigns'),
      ]);
      if (mounted) {
        setState(() {
          _wasteTypes = (results[0].data['wasteTypes'] as List?) ?? [];
          _rates = (results[1].data['rates'] as List?) ?? [];
          _campaigns = (results[2].data['campaigns'] as List?) ?? [];
          _loading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = ApiClient.getErrorMessage(error);
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final orgScopedCount = _wasteTypes
        .where((w) => w['organizationId'] != null)
        .length;
    final globalCount = _wasteTypes.length - orgScopedCount;
    final totalRates = _rates.length;
    final filtered = _wasteTypes.where((row) {
      if (_query.isEmpty) return true;
      final q = _query.toLowerCase();
      final name = row['name']?.toString().toLowerCase() ?? '';
      final orgName =
          row['organization']?['name']?.toString().toLowerCase() ?? '';
      return name.contains(q) || orgName.contains(q);
    }).toList();

    final campaignById = <String, Map<String, dynamic>>{
      for (final c in _campaigns) c['id'] as String: c as Map<String, dynamic>,
    };

    return AdminShell(
      title: 'Jenis Sampah & Tarif',
      child: RefreshIndicator(onRefresh: _load, child: _body(filtered, globalCount, orgScopedCount, totalRates, campaignById)),
    );
  }

  Widget _body(
    List<dynamic> rows,
    int globalCount,
    int orgScopedCount,
    int totalRates,
    Map<String, Map<String, dynamic>> campaignById,
  ) {
    if (_loading) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 100),
        children: const [
          SkeletonListTile(),
          SizedBox(height: 10),
          SkeletonListTile(),
          SizedBox(height: 10),
          SkeletonListTile(),
        ],
      );
    }
    if (_error != null) {
      return _ErrorState(message: _error!, onRetry: _load);
    }
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          sliver: SliverToBoxAdapter(
            child: Row(
              children: [
                Expanded(
                  child: MetricCard(
                    label: 'Global',
                    value: '$globalCount',
                    icon: Icons.public_outlined,
                    tone: MetricTone.green,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: MetricCard(
                    label: 'Per organisasi',
                    value: '$orgScopedCount',
                    icon: Icons.business_outlined,
                    tone: MetricTone.blue,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: MetricCard(
                    label: 'Tarif',
                    value: '$totalRates',
                    icon: Icons.tune_outlined,
                    tone: MetricTone.amber,
                  ),
                ),
              ],
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          sliver: SliverToBoxAdapter(
            child: ReLoopSearchBar(
              hintText: 'Cari jenis sampah atau organisasi...',
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
        ),
        if (rows.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.delete_outline,
              title: 'Belum ada jenis sampah',
              description: _query.isNotEmpty
                  ? 'Coba ubah kata kunci pencarian.'
                  : 'Belum ada jenis sampah yang terdaftar.',
            ),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
            sliver: SliverList.builder(
              itemCount: rows.length,
              itemBuilder: (context, index) {
                final raw = rows[index] as Map<String, dynamic>;
                final ratesForType = _rates
                    .where((r) => r['wasteTypeId'] == raw['id'])
                    .toList();
                return Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _WasteTypeCard(
                    row: raw,
                    rates: ratesForType,
                    campaignById: campaignById,
                  ),
                );
              },
            ),
          ),
      ],
    );
  }
}

class _WasteTypeCard extends StatelessWidget {
  const _WasteTypeCard({
    required this.row,
    required this.rates,
    required this.campaignById,
  });

  final Map<String, dynamic> row;
  final List<dynamic> rates;
  final Map<String, Map<String, dynamic>> campaignById;

  @override
  Widget build(BuildContext context) {
    final org = row['organization'] as Map<String, dynamic>?;
    final orgName = org?['name']?.toString();
    final orgType = org?['type']?.toString();
    final isGlobal = org == null;
    final depositCount = (row['_count']?['depositItems'] as num?)?.toInt() ?? 0;
    final unit = row['unit']?.toString() ?? 'ITEM';
    final defaultReward = (row['defaultRewardPerItem'] as num?)?.toInt() ?? 0;
    final minW = (row['minWeightGrams'] as num?)?.toInt();
    final maxW = (row['maxWeightGrams'] as num?)?.toInt();

    return ReLoopCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: isGlobal
                      ? ReLoopColors.brand600.withValues(alpha: .12)
                      : ReLoopColors.info.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(
                  isGlobal ? Icons.public_outlined : Icons.business_outlined,
                  color: isGlobal
                      ? ReLoopColors.brand600
                      : ReLoopColors.info,
                  size: 19,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      row['name']?.toString() ?? '-',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 13.5,
                      ),
                    ),
                    Text(
                      isGlobal
                          ? 'Global · ${_unitLabel(unit)}'
                          : '$orgName · ${_orgTypeLabel(orgType)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11.5,
                        color: context.reloopMuted,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: context.reloopBrandSoft,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '$depositCount item',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: context.reloopBrandText,
                  ),
                ),
              ),
            ],
          ),
          if (defaultReward > 0 || minW != null || maxW != null) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                if (defaultReward > 0)
                  _Chip(
                    icon: Icons.payments_outlined,
                    label: 'Default ${_formatRp(defaultReward)}',
                  ),
                if (minW != null)
                  _Chip(icon: Icons.scale_outlined, label: 'Min ${minW}g'),
                if (maxW != null)
                  _Chip(icon: Icons.scale_outlined, label: 'Max ${maxW}g'),
              ],
            ),
          ],
          if (rates.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: context.reloopSurface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: context.reloopBorder),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.tune_outlined,
                        size: 13,
                        color: context.reloopMuted,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Tarif khusus',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: context.reloopMuted,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  for (final r in rates)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              campaignById[r['campaignId']]?['name']?.toString() ??
                                  'Tanpa campaign',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 12),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            _formatRp(
                              (r['rewardAmount'] as num?)?.toInt() ?? 0,
                            ),
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: context.reloopBrandText,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _unitLabel(String unit) =>
      unit == 'KG' ? 'Per kilogram' : 'Per item';

  String _orgTypeLabel(String? type) {
    switch (type) {
      case 'SCHOOL':
        return 'Sekolah';
      case 'CAMPUS':
        return 'Kampus';
      case 'VILLAGE':
        return 'Desa';
      case 'TOURISM_SITE':
        return 'Lokasi wisata';
      case 'OFFICE':
        return 'Kantor';
      case 'COMMUNITY':
        return 'Komunitas';
      case 'WASTE_BANK':
        return 'Bank sampah';
      default:
        return 'Organisasi';
    }
  }

  String _formatRp(int value) {
    final s = value.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) buffer.write('.');
      buffer.write(s[i]);
    }
    return 'Rp $buffer';
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: context.reloopSurface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: context.reloopBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: context.reloopMuted),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 11, color: context.reloopMuted),
          ),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 120),
        Icon(
          Icons.cloud_off_rounded,
          size: 48,
          color: context.reloopMutedSoft,
        ),
        const SizedBox(height: 12),
        Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(color: context.reloopMuted),
        ),
        const SizedBox(height: 8),
        Center(
          child: TextButton(onPressed: onRetry, child: Text('Coba lagi')),
        ),
      ],
    );
  }
}
