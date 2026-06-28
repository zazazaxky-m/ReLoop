import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../shared/widgets/promo_carousel.dart';
import '../../shared/widgets/quick_action.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';

class UserDashboardScreen extends StatefulWidget {
  const UserDashboardScreen({super.key});

  @override
  State<UserDashboardScreen> createState() => _UserDashboardScreenState();
}

class _UserDashboardScreenState extends State<UserDashboardScreen> {
  UserDashboard? _dashboard;
  bool _loading = true;
  String? _error;

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
      final response = await context.read<ApiClient>().get(
        '/api/user/dashboard',
      );
      final data = response.data;
      if (data is! Map<String, dynamic>) {
        throw Exception('Format dashboard tidak valid');
      }
      if (mounted) {
        setState(() {
          _dashboard = UserDashboard.fromJson(data);
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
    return Scaffold(
      body: RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    if (_loading) return const SkeletonDashboard();
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
          TextButton(onPressed: _load, child: Text('Coba lagi')),
        ],
      );
    }

    final dashboard = _dashboard!;
    final user = context.watch<AuthProvider>().user;
    final firstName = (user?.name ?? 'Pengguna').split(' ').first;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 110),
      children: [
        const PromoCarousel(),
        const SizedBox(height: 16),
        _WalletSummary(
          firstName: firstName,
          balance: dashboard.balance,
          onWallet: () => context.push('/wallet'),
          onHistory: () => context.push('/wallet'),
          onProfile: () => context.push('/profile'),
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
              icon: Icons.campaign_outlined,
              title: 'Program',
              description: 'Promo aktif',
              tone: QuickActionTone.blue,
              onTap: () => context.push('/campaigns'),
            ),
            QuickAction(
              icon: Icons.inventory_2_outlined,
              title: 'Trash Bag',
              description: 'Kantong QR',
              tone: QuickActionTone.green,
              onTap: () => context.push('/trash-bags'),
            ),
            QuickAction(
              icon: Icons.payments_outlined,
              title: 'Pencairan',
              description: 'Tarik reward',
              tone: QuickActionTone.teal,
              onTap: () => context.push('/wallet/redemption'),
            ),
            QuickAction(
              icon: Icons.map_outlined,
              title: 'Cari Mesin',
              description: 'Lokasi mesin',
              tone: QuickActionTone.blue,
              onTap: () => context.push('/map'),
            ),
          ],
        ),
        const SizedBox(height: 24),
        _SectionTitle(
          title: 'Aktivitas terakhir',
          action: 'Lihat dompet',
          onAction: () => context.push('/wallet'),
        ),
        const SizedBox(height: 10),
        ..._sessions(dashboard),
        const SizedBox(height: 22),
        _SectionTitle(
          title: 'Program untuk kamu',
          action: 'Lihat semua',
          onAction: () => context.push('/campaigns'),
        ),
        const SizedBox(height: 10),
        ..._campaigns(dashboard),
        const SizedBox(height: 22),
        const _SectionTitle(title: 'Reward terbaru'),
        const SizedBox(height: 10),
        ..._ledger(dashboard),
      ],
    );
  }

  List<Widget> _sessions(UserDashboard dashboard) {
    if (dashboard.recentSessions.isEmpty) {
      return const [_EmptyRow('Belum ada aktivitas setor.')];
    }
    return dashboard.recentSessions.take(4).map((session) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: ReLoopCard(
          child: Row(
            children: [
              const _ActivityIcon(
                icon: Icons.recycling_rounded,
                tone: QuickActionTone.green,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session.machine?.name ?? 'Mesin ReLoop',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      _formatDate(session.startedAt),
                      style: TextStyle(
                        color: context.reloopMuted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              StatusBadge(statusKey: session.status),
            ],
          ),
        ),
      );
    }).toList();
  }

  List<Widget> _campaigns(UserDashboard dashboard) {
    final campaigns = dashboard.campaigns
        .where((item) => item.status == 'ACTIVE')
        .take(3);
    if (campaigns.isEmpty) {
      return const [_EmptyRow('Belum ada program aktif.')];
    }
    return campaigns.map((campaign) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: ReLoopCard(
          child: Row(
            children: [
              const _ActivityIcon(
                icon: Icons.campaign_rounded,
                tone: QuickActionTone.blue,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      campaign.name,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      campaign.organizationName ?? 'ReLoop',
                      style: TextStyle(
                        color: context.reloopMuted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                color: context.reloopMutedSoft,
              ),
            ],
          ),
        ),
      );
    }).toList();
  }

  List<Widget> _ledger(UserDashboard dashboard) {
    if (dashboard.recentLedger.isEmpty) {
      return const [_EmptyRow('Belum ada riwayat reward.')];
    }
    return dashboard.recentLedger.take(4).map((entry) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: ReLoopCard(
          child: Row(
            children: [
              const _ActivityIcon(
                icon: Icons.savings_outlined,
                tone: QuickActionTone.amber,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      entry.wasteTypeName ?? entry.entryType,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      _formatDate(entry.createdAt),
                      style: TextStyle(
                        color: context.reloopMuted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                '${entry.amount >= 0 ? '+' : ''}${_currency(entry.amount)}',
                style: TextStyle(
                  color: entry.amount >= 0
                      ? context.reloopBrandText
                      : ReLoopColors.danger,
                  fontWeight: FontWeight.w800,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      );
    }).toList();
  }
}

class _WalletSummary extends StatelessWidget {
  const _WalletSummary({
    required this.firstName,
    required this.balance,
    required this.onWallet,
    required this.onHistory,
    required this.onProfile,
  });

  final String firstName;
  final WalletBalance balance;
  final VoidCallback onWallet;
  final VoidCallback onHistory;
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
              onTap: onWallet,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    balance.availableFormatted,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -.3,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Halo, $firstName - Saldo tersedia',
                    style: TextStyle(
                      color: context.reloopMuted,
                      fontSize: 10.5,
                    ),
                  ),
                ],
              ),
            ),
          ),
          _SummaryAction(
            icon: Icons.payments_outlined,
            label: 'Cairkan',
            onTap: onWallet,
          ),
          const SizedBox(width: 5),
          _SummaryAction(
            icon: Icons.history_rounded,
            label: 'Riwayat',
            onTap: onHistory,
          ),
        ],
      ),
    );
  }
}

class _SummaryAction extends StatelessWidget {
  const _SummaryAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: SizedBox(
        width: 50,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: ReLoopColors.brand600,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: Colors.white, size: 19),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                color: context.reloopMuted,
                fontSize: 9,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
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
    final color = switch (tone) {
      QuickActionTone.green => ReLoopColors.brand600,
      QuickActionTone.blue => ReLoopColors.info,
      QuickActionTone.amber => ReLoopColors.warning,
      QuickActionTone.teal => const Color(0xFF159A91),
    };
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: color.withValues(alpha: .1),
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

String _currency(int amount) {
  final formatted = amount.toString().replaceAllMapped(
    RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
    (match) => '${match[1]}.',
  );
  return 'Rp $formatted';
}

String _formatDate(String iso) {
  try {
    final date = DateTime.parse(iso).toLocal();
    final minute = date.minute.toString().padLeft(2, '0');
    return '${date.day}/${date.month}/${date.year} ${date.hour}:$minute';
  } catch (_) {
    return iso;
  }
}
