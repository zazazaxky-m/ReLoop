import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class UserDashboardScreen extends StatefulWidget {
  const UserDashboardScreen({super.key});

  @override
  State<UserDashboardScreen> createState() => _UserDashboardScreenState();
}

class _UserDashboardScreenState extends State<UserDashboardScreen> {
  UserDashboard? _dashboard;
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
      final response = await api.get('/api/user/dashboard');
      final data = response.data as Map<String, dynamic>;
      setState(() {
        _dashboard = UserDashboard.fromJson(data);
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
    final auth = context.watch<AuthProvider>();
    final user = auth.user!;

    return Scaffold(
      appBar: AppBar(
        title: Text('Halo, ${user.name.split(' ').first}!'),
        actions: [
          IconButton(
            icon: CircleAvatar(
              radius: 16,
              backgroundColor: ReLoopColors.brand100,
              child: Text(
                user.name[0].toUpperCase(),
                style: const TextStyle(
                  color: ReLoopColors.brand700,
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
            ),
            onPressed: () => context.push('/profile'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDashboard,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const SkeletonDashboard();
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
            TextButton(onPressed: _loadDashboard, child: const Text('Coba Lagi')),
          ],
        ),
      );
    }

    final d = _dashboard!;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Balance card
        ReLoopCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.account_balance_wallet,
                      color: ReLoopColors.brand500, size: 20),
                  const SizedBox(width: 8),
                  const Text(
                    'Saldo Anda',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: ReLoopColors.muted,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                d.balance.availableFormatted,
                style: const TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.w800,
                  color: ReLoopColors.foreground,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Tersedia untuk dicairkan',
                style: const TextStyle(color: ReLoopColors.mutedSoft, fontSize: 12),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  _balanceStat('Pending', 'Rp ${_fmt(d.balance.pending)}'),
                  const SizedBox(width: 16),
                  _balanceStat('Dicairkan', 'Rp ${_fmt(d.balance.redeemed)}'),
                  const SizedBox(width: 16),
                  _balanceStat('Total', 'Rp ${_fmt(d.balance.totalEarned)}'),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),

        // Quick actions
        Row(
          children: [
            Expanded(
              child: _QuickActionCard(
                icon: Icons.qr_code_scanner,
                label: 'Scan Mesin',
                color: ReLoopColors.brand500,
                onTap: () => context.push('/scan'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _QuickActionCard(
                icon: Icons.map,
                label: 'Peta Mesin',
                color: ReLoopColors.info,
                onTap: () => context.push('/map'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _QuickActionCard(
                icon: Icons.delete_outline,
                label: 'Trash Bag',
                color: ReLoopColors.accent,
                onTap: () => context.push('/trash-bags'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),

        Row(
          children: [
            Expanded(
              child: _QuickActionCard(
                icon: Icons.wallet,
                label: 'Dompet',
                color: ReLoopColors.statusFull,
                onTap: () => context.push('/wallet'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _QuickActionCard(
                icon: Icons.payment,
                label: 'Cairkan',
                color: ReLoopColors.brand600,
                onTap: () => context.push('/wallet/redemption'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _QuickActionCard(
                icon: Icons.local_shipping,
                label: 'Pickup',
                color: ReLoopColors.info,
                onTap: () => context.push('/pickup'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),

        // Campaign section
        if (d.campaigns.isNotEmpty) ...[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Program Aktif',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: ReLoopColors.foreground,
                ),
              ),
              TextButton(
                onPressed: () => context.push('/campaigns'),
                child: const Text('Lihat Semua'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ...d.campaigns.take(3).map((c) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: ReLoopCard(
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: ReLoopColors.brand50,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(Icons.campaign,
                            color: ReLoopColors.brand500, size: 20),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              c.name,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                color: ReLoopColors.foreground,
                                fontSize: 14,
                              ),
                            ),
                            if (c.description != null)
                              Text(
                                c.description!,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: ReLoopColors.mutedSoft,
                                  fontSize: 12,
                                ),
                              ),
                          ],
                        ),
                      ),
                      StatusBadge(statusKey: c.status),
                    ],
                  ),
                ),
              )),
        ],

        // Recent sessions
        if (d.recentSessions.isNotEmpty) ...[
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Sesi Terakhir',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: ReLoopColors.foreground,
                ),
              ),
              if (d.recentSessions.length > 3)
                TextButton(
                  onPressed: () => context.push('/scan'),
                  child: const Text('Lihat Semua'),
                ),
            ],
          ),
          const SizedBox(height: 8),
          ...d.recentSessions.take(3).map((s) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: ReLoopCard(
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: ReLoopColors.mintSoft,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(Icons.recycling,
                            color: ReLoopColors.brand500, size: 20),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              s.machine?.name ?? 'Mesin',
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                color: ReLoopColors.foreground,
                                fontSize: 14,
                              ),
                            ),
                            Text(
                              _formatDate(s.startedAt),
                              style: const TextStyle(
                                color: ReLoopColors.mutedSoft,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                      StatusBadge(statusKey: s.status),
                    ],
                  ),
                ),
              )),
        ],

        // Recent reward history
        if (d.recentLedger.isNotEmpty) ...[
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Riwayat Reward',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: ReLoopColors.foreground,
                ),
              ),
              TextButton(
                onPressed: () => context.push('/wallet'),
                child: const Text('Lihat Dompet'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ...d.recentLedger.take(3).map((entry) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: ReLoopCard(
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: entry.amount >= 0
                              ? ReLoopColors.brand50
                              : ReLoopColors.tones['danger']!.bg,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(
                          entry.amount >= 0
                              ? Icons.add_circle_outline
                              : Icons.remove_circle_outline,
                          color: entry.amount >= 0
                              ? ReLoopColors.brand500
                              : ReLoopColors.danger,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(
                                  '${entry.amount >= 0 ? "+" : ""}Rp ${_fmt(entry.amount.abs())}',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w600,
                                    color: entry.amount >= 0
                                        ? ReLoopColors.brand700
                                        : ReLoopColors.danger,
                                    fontSize: 14,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                StatusBadge(statusKey: entry.status),
                              ],
                            ),
                            Text(
                              entry.wasteTypeName ?? entry.entryType,
                              style: const TextStyle(
                                color: ReLoopColors.mutedSoft,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        _formatDate(entry.createdAt),
                        style: const TextStyle(
                          color: ReLoopColors.mutedSoft,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
              )),
        ],

        const SizedBox(height: 80),
      ],
    );
  }

  Widget _balanceStat(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: ReLoopColors.mutedSoft, fontSize: 11)),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(
            fontWeight: FontWeight.w600,
            color: ReLoopColors.foreground,
            fontSize: 13,
          ),
        ),
      ],
    );
  }

  String _fmt(int amount) {
    return amount.toString().replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]}.',
    );
  }

  String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return iso;
    }
  }
}

class _QuickActionCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _QuickActionCard({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: ReLoopColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: ReLoopColors.border),
          ),
          child: Column(
            children: [
              Icon(icon, color: color, size: 28),
              const SizedBox(height: 8),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: ReLoopColors.foreground,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
