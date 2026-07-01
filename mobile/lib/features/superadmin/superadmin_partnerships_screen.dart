import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/filter_chips.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/search_bar.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';
import '../admin/admin_shell.dart';

/// Layar khusus superadmin untuk mengelola kemitraan pengepul.
/// Menampilkan 3 metric (pending, aktif, total) + daftar partnership
/// dengan info pengepul, organisasi, service area, dan aksi approval.
class SuperadminPartnershipsScreen extends StatefulWidget {
  const SuperadminPartnershipsScreen({super.key});

  @override
  State<SuperadminPartnershipsScreen> createState() =>
      _SuperadminPartnershipsScreenState();
}

class _SuperadminPartnershipsScreenState
    extends State<SuperadminPartnershipsScreen> {
  List<dynamic> _rows = [];
  String? _error;
  String _query = '';
  String? _statusFilter;
  bool _loading = true;

  static const _statusOptions = [
    'PENDING_SUPERADMIN_APPROVAL',
    'REQUESTED',
    'INVITED',
    'ACTIVE',
    'SUSPENDED',
    'REJECTED',
    'REMOVED',
  ];

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
      final res = await context.read<ApiClient>().get('/api/partnerships');
      if (mounted) {
        setState(() {
          _rows = (res.data['partnerships'] as List?) ?? [];
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

  Future<void> _act(String id, String action) async {
    try {
      await context.read<ApiClient>().patch(
        '/api/partnerships/$id',
        data: {'action': action},
      );
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Perubahan disimpan'),
            backgroundColor: ReLoopColors.success,
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiClient.getErrorMessage(error)),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final pending =
        _rows.where((r) => r['status'] == 'PENDING_SUPERADMIN_APPROVAL').length;
    final active = _rows.where((r) => r['status'] == 'ACTIVE').length;
    final filtered = _rows.where((row) {
      final r = row as Map<String, dynamic>;
      if (_statusFilter != null && r['status'] != _statusFilter) return false;
      if (_query.isEmpty) return true;
      final q = _query.toLowerCase();
      final org = r['organization']?['name']?.toString().toLowerCase() ?? '';
      final collector = r['collectorUser']?['name']?.toString().toLowerCase() ??
          '';
      final email =
          r['collectorUser']?['email']?.toString().toLowerCase() ?? '';
      return org.contains(q) || collector.contains(q) || email.contains(q);
    }).toList();

    return AdminShell(
      title: 'Kemitraan',
      child: RefreshIndicator(onRefresh: _load, child: _body(filtered, pending, active)),
    );
  }

  Widget _body(List<dynamic> rows, int pending, int active) {
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
                    label: 'Menunggu approval',
                    value: '$pending',
                    icon: Icons.schedule_outlined,
                    tone: MetricTone.amber,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: MetricCard(
                    label: 'Kemitraan aktif',
                    value: '$active',
                    icon: Icons.verified_user_outlined,
                    tone: MetricTone.green,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: MetricCard(
                    label: 'Total',
                    value: '${_rows.length}',
                    icon: Icons.handshake_outlined,
                    tone: MetricTone.blue,
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
              hintText: 'Cari kemitraan...',
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          sliver: SliverToBoxAdapter(
            child: ReLoopFilterChips(
              label: 'Status',
              options: _statusOptions,
              selected: _statusFilter,
              onSelected: (v) => setState(() => _statusFilter = v),
            ),
          ),
        ),
        if (rows.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.handshake_outlined,
              title: 'Belum ada kemitraan',
              description: _query.isNotEmpty || _statusFilter != null
                  ? 'Coba ubah pencarian atau filter.'
                  : 'Belum ada kemitraan yang terdaftar.',
            ),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
            sliver: SliverList.builder(
              itemCount: rows.length,
              itemBuilder: (context, index) {
                final raw = rows[index] as Map<String, dynamic>;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _PartnershipCard(
                    row: raw,
                    onAction: (action) => _act(raw['id'], action),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }
}

class _PartnershipCard extends StatelessWidget {
  const _PartnershipCard({required this.row, required this.onAction});
  final Map<String, dynamic> row;
  final ValueChanged<String> onAction;

  @override
  Widget build(BuildContext context) {
    final org = row['organization'] as Map<String, dynamic>?;
    final collector = row['collectorUser'] as Map<String, dynamic>?;
    final status = (row['status'] as String?) ?? 'REQUESTED';
    final serviceArea = row['serviceAreaJson'] as Map<String, dynamic>?;
    final regions =
        (serviceArea?['regions'] as List?)?.map((e) => e.toString()).toList() ??
            const <String>[];
    final note = serviceArea?['note']?.toString();

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
                  color: context.reloopBrandSoft,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(
                  Icons.handshake_outlined,
                  color: context.reloopBrandText,
                  size: 19,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      collector?['name']?.toString() ?? 'Pengepul',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 13.5,
                      ),
                    ),
                    if (org != null && org['name'] != null)
                      Text(
                        'Mitra: ${org['name']}',
                        style: TextStyle(
                          fontSize: 11.5,
                          color: context.reloopMuted,
                        ),
                      ),
                  ],
                ),
              ),
              StatusBadge(statusKey: status),
            ],
          ),
          const SizedBox(height: 10),
          _InfoRow(
            icon: Icons.alternate_email_rounded,
            label: collector?['email']?.toString() ?? '-',
          ),
          if (collector?['phone'] != null) ...[
            const SizedBox(height: 3),
            _InfoRow(
              icon: Icons.phone_outlined,
              label: collector!['phone'].toString(),
            ),
          ],
          if (regions.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
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
                        Icons.public_outlined,
                        size: 13,
                        color: context.reloopMuted,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Wilayah layanan',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: context.reloopMuted,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    regions.join(', '),
                    style: const TextStyle(fontSize: 12),
                  ),
                  if (note != null && note.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Catatan: $note',
                      style: TextStyle(
                        fontSize: 11.5,
                        color: context.reloopMutedSoft,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
          if (_actionsFor(status).isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              alignment: WrapAlignment.end,
              children: [
                for (final action in _actionsFor(status))
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: action.danger
                          ? ReLoopColors.danger
                          : context.reloopBrandText,
                      side: BorderSide(
                        color: action.danger
                            ? ReLoopColors.danger.withValues(alpha: .5)
                            : context.reloopBrandText.withValues(alpha: .4),
                      ),
                      minimumSize: const Size(0, 32),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 4,
                      ),
                    ),
                    onPressed: () => onAction(action.value),
                    child: Text(
                      action.label,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  List<_PartnershipAction> _actionsFor(String status) {
    switch (status) {
      case 'PENDING_SUPERADMIN_APPROVAL':
        return const [
          _PartnershipAction('Setujui', 'approve', false),
          _PartnershipAction('Tolak', 'reject', true),
        ];
      case 'ACTIVE':
        return const [
          _PartnershipAction('Tangguhkan', 'suspend', false),
          _PartnershipAction('Hapus', 'remove', true),
        ];
      case 'SUSPENDED':
        return const [
          _PartnershipAction('Aktifkan', 'reactivate', false),
          _PartnershipAction('Hapus', 'remove', true),
        ];
      case 'INVITED':
      case 'REQUESTED':
        return const [_PartnershipAction('Hapus', 'remove', true)];
      default:
        return const [];
    }
  }
}

class _PartnershipAction {
  final String label;
  final String value;
  final bool danger;
  const _PartnershipAction(this.label, this.value, this.danger);
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 13, color: context.reloopMutedSoft),
        const SizedBox(width: 5),
        Expanded(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12, color: context.reloopMutedSoft),
          ),
        ),
      ],
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
