import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
import '../../shared/widgets/promo_carousel.dart';
import '../../shared/widgets/quick_action.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'admin_shell.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});
  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  List<dynamic> _machines = [];
  List<dynamic> _pickups = [];
  int _campaignCount = 0;
  int _depositCount = 0;
  int _partnershipCount = 0;
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
      final res = await context.read<ApiClient>().get('/api/mobile/overview');
      final data = res.data as Map<String, dynamic>;
      setState(() {
        _machines = (data['machines'] as List?)?.cast<dynamic>() ?? [];
        _pickups = (data['pickups'] as List?)?.cast<dynamic>() ?? [];
        _campaignCount = (data['campaignCount'] as num?)?.toInt() ?? 0;
        _depositCount = (data['depositCount'] as num?)?.toInt() ?? 0;
        _partnershipCount = (data['partnershipCount'] as num?)?.toInt() ?? 0;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  int get _fullCount => _machines.where((m) => m['status'] == 'FULL').length;
  int get _attentionCount => _machines
      .where((m) => ['OFFLINE', 'ERROR', 'MAINTENANCE'].contains(m['status']))
      .length;

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Dashboard Admin',
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
            Text(_error ?? '', style: TextStyle(color: context.reloopMuted)),
            TextButton(onPressed: _load, child: Text('Coba Lagi')),
          ],
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
      children: [
        const PromoCarousel(),
        const SizedBox(height: 16),
        _AdminSummaryCard(
          totalMachines: _machines.length,
          fullMachines: _fullCount,
          attentionCount: _attentionCount,
          campaignCount: _campaignCount,
          depositCount: _depositCount,
          partnershipCount: _partnershipCount,
        ),
        const SizedBox(height: 22),
        Text(
          'Layanan ReLoop',
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
              icon: Icons.qr_code_scanner_outlined,
              title: 'Scan',
              description: 'Trash bag',
              tone: QuickActionTone.green,
              onTap: () => context.push('/scan'),
            ),
            QuickAction(
              icon: Icons.luggage_outlined,
              title: 'Trash Bag',
              description: 'Trip wisata',
              tone: QuickActionTone.blue,
              onTap: () => context.push('/admin/trips'),
            ),
            QuickAction(
              icon: Icons.campaign_outlined,
              title: 'Program',
              description: 'Campaign',
              tone: QuickActionTone.teal,
              onTap: () => context.push('/admin/campaigns'),
            ),
            QuickAction(
              icon: Icons.delete_outline,
              title: 'Sampah',
              description: 'Jenis tarif',
              tone: QuickActionTone.amber,
              onTap: () => context.push('/admin/waste-types'),
            ),
            QuickAction(
              icon: Icons.recycling_outlined,
              title: 'Mesin',
              description: 'Status unit',
              tone: QuickActionTone.blue,
              onTap: () => context.push('/admin/machines'),
            ),
            QuickAction(
              icon: Icons.local_shipping_outlined,
              title: 'Pickup',
              description: 'Jemput sampah',
              tone: QuickActionTone.green,
              onTap: () => context.push('/admin/pickups'),
            ),
            QuickAction(
              icon: Icons.description_outlined,
              title: 'Laporan',
              description: 'Unduhan',
              tone: QuickActionTone.teal,
              onTap: () => context.push('/admin/reports'),
            ),
            QuickAction(
              icon: Icons.grid_view_rounded,
              title: 'Lainnya',
              description: 'Menu admin',
              tone: QuickActionTone.amber,
              onTap: () => showAdminMoreBottomSheet(context, false),
            ),
          ],
        ),
        const SizedBox(height: 24),
        _SectionTitle(
          title: 'Status mesin',
          action: 'Lihat semua',
          onAction: () => context.push('/admin/machines'),
        ),
        const SizedBox(height: 10),
        _buildSection(
          _machines.isEmpty ? 'Belum ada mesin.' : null,
          children: _machines.take(5).map(_buildMachineTile).toList(),
        ),
        const SizedBox(height: 22),
        _SectionTitle(
          title: 'Pickup aktif',
          action: 'Lihat semua',
          onAction: () => context.push('/admin/pickups'),
        ),
        const SizedBox(height: 10),
        _buildSection(
          _pickups.isEmpty ? 'Tidak ada pickup aktif.' : null,
          children: [
            ..._pickups.take(5).map(_buildPickupTile),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text(
                'Total sesi selesai organisasi: $_depositCount',
                style: TextStyle(
                  color: context.reloopMutedSoft,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 80),
      ],
    );
  }

  Widget _buildSection(String? emptyText, {required List<Widget> children}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (emptyText != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: Text(
                emptyText,
                style: TextStyle(color: context.reloopMutedSoft, fontSize: 13),
              ),
            ),
          )
        else
          ...children,
      ],
    );
  }

  Widget _buildMachineTile(dynamic m) {
    final fillLevel = (m['fillLevelPercent'] as num?)?.toInt() ?? 0;
    final fillColor = fillLevel >= 80
        ? ReLoopColors.statusFull
        : fillLevel >= 50
        ? ReLoopColors.statusFull.withValues(alpha: 0.7)
        : ReLoopColors.brand500;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
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
                        (m['name'] as String?) ?? 'Mesin',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                          color: context.reloopForeground,
                        ),
                      ),
                      if (m['machineCode'] != null)
                        Text(
                          m['machineCode'] as String,
                          style: TextStyle(
                            fontSize: 11,
                            color: context.reloopMutedSoft,
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '$fillLevel%',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: fillColor,
                  ),
                ),
                const SizedBox(width: 8),
                StatusBadge(statusKey: (m['status'] as String?) ?? 'OFFLINE'),
              ],
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: fillLevel / 100,
                minHeight: 4,
                backgroundColor: context.reloopBorder,
                valueColor: AlwaysStoppedAnimation<Color>(fillColor),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPickupTile(dynamic p) {
    final machine = p['machine'] as Map<String, dynamic>?;
    final status = (p['status'] as String?) ?? 'REQUESTED';
    final itemCount = (p['_count']?['items'] as num?)?.toInt() ?? 0;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: ReLoopCard(
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    machine?['name'] as String? ?? 'Pickup #',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                      color: context.reloopForeground,
                    ),
                  ),
                  if (p['notes'] != null)
                    Text(
                      p['notes'] as String,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11,
                        color: context.reloopMutedSoft,
                      ),
                    ),
                ],
              ),
            ),
            if (itemCount > 0)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Text(
                  '$itemCount item',
                  style: TextStyle(
                    fontSize: 11,
                    color: context.reloopMutedSoft,
                  ),
                ),
              ),
            StatusBadge(statusKey: status),
          ],
        ),
      ),
    );
  }
}

class _AdminSummaryCard extends StatelessWidget {
  const _AdminSummaryCard({
    required this.totalMachines,
    required this.fullMachines,
    required this.attentionCount,
    required this.campaignCount,
    required this.depositCount,
    required this.partnershipCount,
  });

  final int totalMachines;
  final int fullMachines;
  final int attentionCount;
  final int campaignCount;
  final int depositCount;
  final int partnershipCount;

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final firstName = (user?.name ?? 'Admin').split(' ').first;
    return ReLoopCard(
      padding: const EdgeInsets.fromLTRB(16, 15, 14, 15),
      child: Row(
        children: [
          CircleAvatar(
            radius: 23,
            backgroundColor: context.reloopBrandSoftStrong,
            child: Text(
              firstName.isEmpty ? 'A' : firstName[0].toUpperCase(),
              style: TextStyle(
                color: context.reloopBrandText,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$totalMachines mesin',
                  style: TextStyle(
                    color: context.reloopForeground,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -.3,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Halo, $firstName - $_statusSummary',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: context.reloopMuted, fontSize: 10.5),
                ),
              ],
            ),
          ),
          _SummaryMetric(
            icon: Icons.inventory_2_outlined,
            value: fullMachines,
            label: 'Penuh',
            tone: QuickActionTone.amber,
          ),
          const SizedBox(width: 5),
          _SummaryMetric(
            icon: Icons.warning_amber_rounded,
            value: attentionCount,
            label: 'Pantau',
            tone: attentionCount > 0
                ? QuickActionTone.amber
                : QuickActionTone.green,
          ),
        ],
      ),
    );
  }

  String get _statusSummary {
    return '$campaignCount campaign, $depositCount sesi, $partnershipCount mitra';
  }
}

class _SummaryMetric extends StatelessWidget {
  const _SummaryMetric({
    required this.icon,
    required this.value,
    required this.label,
    required this.tone,
  });

  final IconData icon;
  final int value;
  final String label;
  final QuickActionTone tone;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      QuickActionTone.green => ReLoopColors.brand600,
      QuickActionTone.blue => ReLoopColors.info,
      QuickActionTone.amber => ReLoopColors.warning,
      QuickActionTone.teal => ReLoopColors.accent,
    };
    return SizedBox(
      width: 50,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: Colors.white, size: 19),
          ),
          const SizedBox(height: 4),
          Text(
            '$label $value',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: context.reloopMuted,
              fontSize: 9,
              fontWeight: FontWeight.w600,
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
