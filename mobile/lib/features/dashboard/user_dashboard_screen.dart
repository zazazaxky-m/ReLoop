import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../services/offline_service.dart';
import '../../shared/format.dart';
import '../../shared/widgets/notification_bell.dart';
import '../../shared/widgets/promo_carousel.dart';
import '../../shared/widgets/quick_action.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';
import '../../theme/dimens.dart';

class UserDashboardScreen extends StatefulWidget {
  const UserDashboardScreen({super.key});

  @override
  State<UserDashboardScreen> createState() => _UserDashboardScreenState();
}

class _UserDashboardScreenState extends State<UserDashboardScreen> {
  static const _cacheKey = 'dashboard';

  UserDashboard? _dashboard;
  bool _loading = true;
  bool _isOffline = false;
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
      await OfflineService().cache(_cacheKey, data);
      if (mounted) {
        setState(() {
          _dashboard = UserDashboard.fromJson(data);
          _loading = false;
          _isOffline = false;
        });
      }
    } catch (error) {
      final cached = OfflineService().get(_cacheKey);
      if (cached is Map<String, dynamic>) {
        if (mounted) {
          setState(() {
            _dashboard = UserDashboard.fromJson(cached);
            _loading = false;
            _isOffline = true;
            _error = null;
          });
        }
        return;
      }
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
      return ReLoopErrorStateScrollable(message: _error!, onRetry: _load);
    }

    final dashboard = _dashboard!;
    final user = context.watch<AuthProvider>().user;
    final firstName = (user?.name ?? 'Pengguna').split(' ').first;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        ReLoopSpacing.lg,
        ReLoopSpacing.sm,
        ReLoopSpacing.lg,
        110,
      ),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Beranda',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  color: context.reloopForeground,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -.4,
                ),
              ),
            ),
            const NotificationBell(),
          ],
        ),
        const SizedBox(height: ReLoopSpacing.xs),
        if (_isOffline) ...[
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: ReLoopSpacing.md,
              vertical: ReLoopSpacing.sm,
            ),
            decoration: BoxDecoration(
              color: context.reloopTone('warning').bg,
              borderRadius: ReLoopRadius.brSm,
              border: Border.all(color: context.reloopTone('warning').border),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.cloud_off_rounded,
                  size: 16,
                  color: context.reloopTone('warning').text,
                ),
                const SizedBox(width: ReLoopSpacing.sm),
                Expanded(
                  child: Text(
                    'Menampilkan data tersimpan (offline). Tarik untuk menyegarkan.',
                    style: TextStyle(
                      color: context.reloopTone('warning').text,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: ReLoopSpacing.md),
        ],
        const PromoCarousel(),
        const SizedBox(height: ReLoopSpacing.lg),
        _WalletSummary(
          firstName: firstName,
          balance: dashboard.balance,
          showPoints: dashboard.isTravelAgent,
          pointsToRupiah: dashboard.pointsToRupiah,
          onWallet: () => context.push('/wallet'),
          onHistory: () => context.push('/wallet'),
          onProfile: () => context.push('/profile'),
        ),
        const SizedBox(height: ReLoopSpacing.xl),
        Text(
          'Layanan ReLoop',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            color: context.reloopForeground,
            fontWeight: FontWeight.w800,
            letterSpacing: -.2,
          ),
        ),
        const SizedBox(height: ReLoopSpacing.md),
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
              tone: QuickActionTone.amber,
              onTap: () => context.push('/map'),
            ),
          ],
        ),
        const SizedBox(height: ReLoopSpacing.xxl),
        _SectionTitle(
          title: 'Aktivitas terakhir',
          action: 'Lihat dompet',
          onAction: () => context.push('/wallet'),
        ),
        const SizedBox(height: ReLoopSpacing.sm),
        ..._sessions(dashboard),
        const SizedBox(height: ReLoopSpacing.xl),
        _SectionTitle(
          title: 'Program untuk kamu',
          action: 'Lihat semua',
          onAction: () => context.push('/campaigns'),
        ),
        const SizedBox(height: ReLoopSpacing.sm),
        ..._campaigns(dashboard),
        const SizedBox(height: ReLoopSpacing.xl),
        const _SectionTitle(title: 'Reward terbaru'),
        const SizedBox(height: ReLoopSpacing.sm),
        ..._ledger(dashboard),
      ],
    );
  }

  List<Widget> _sessions(UserDashboard dashboard) {
    if (dashboard.recentSessions.isEmpty) {
      return const [
        ReLoopEmptyState(
          compact: true,
          icon: Icons.recycling_rounded,
          title: 'Belum ada aktivitas setor',
          description: 'Setor sampah kamu bakal muncul di sini.',
        ),
      ];
    }
    return dashboard.recentSessions.take(4).map((session) {
      return Padding(
        padding: const EdgeInsets.only(bottom: ReLoopSpacing.sm),
        child: ReLoopCard(
          child: Row(
            children: [
              const _ActivityIcon(
                icon: Icons.recycling_rounded,
                tone: QuickActionTone.amber,
              ),
              const SizedBox(width: ReLoopSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session.machine?.name ?? 'Mesin ReLoop',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: context.reloopForeground,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      formatDateTimeIso(session.startedAt),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: context.reloopMuted,
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
      return const [
        ReLoopEmptyState(
          compact: true,
          icon: Icons.campaign_outlined,
          title: 'Belum ada program aktif',
          description: 'Program baru buat kamu bakal tampil di sini.',
        ),
      ];
    }
    return campaigns.map((campaign) {
      return Padding(
        padding: const EdgeInsets.only(bottom: ReLoopSpacing.sm),
        child: ReLoopCard(
          child: Row(
            children: [
              const _ActivityIcon(
                icon: Icons.campaign_rounded,
                tone: QuickActionTone.blue,
              ),
              const SizedBox(width: ReLoopSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      campaign.name,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: context.reloopForeground,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      campaign.organizationName ?? 'ReLoop',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: context.reloopMuted,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: context.reloopMutedSoft),
            ],
          ),
        ),
      );
    }).toList();
  }

  List<Widget> _ledger(UserDashboard dashboard) {
    if (dashboard.recentLedger.isEmpty) {
      return const [
        ReLoopEmptyState(
          compact: true,
          icon: Icons.savings_outlined,
          title: 'Belum ada riwayat reward',
          description: 'Reward dari setoran kamu bakal tercatat di sini.',
        ),
      ];
    }
    return dashboard.recentLedger.take(4).map((entry) {
      return Padding(
        padding: const EdgeInsets.only(bottom: ReLoopSpacing.sm),
        child: ReLoopCard(
          child: Row(
            children: [
              const _ActivityIcon(
                icon: Icons.savings_outlined,
                tone: QuickActionTone.teal,
              ),
              const SizedBox(width: ReLoopSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      entry.displayLabel,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: context.reloopForeground,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      formatDateTimeIso(entry.createdAt),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: context.reloopMuted,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                '${entry.amount >= 0 ? '+' : ''}${formatRupiah(entry.amount)}',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: entry.amount >= 0
                      ? context.reloopBrandText
                      : ReLoopColors.danger,
                  fontWeight: FontWeight.w800,
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
    required this.showPoints,
    required this.pointsToRupiah,
    required this.onWallet,
    required this.onHistory,
    required this.onProfile,
  });

  final String firstName;
  final WalletBalance balance;
  final bool showPoints;
  final int pointsToRupiah;
  final VoidCallback onWallet;
  final VoidCallback onHistory;
  final VoidCallback onProfile;

  @override
  Widget build(BuildContext context) {
    final points = (showPoints && pointsToRupiah > 0)
        ? balance.available ~/ pointsToRupiah
        : 0;
    return ReLoopCard(
      padding: const EdgeInsets.all(ReLoopSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              InkWell(
                onTap: onProfile,
                borderRadius: BorderRadius.circular(ReLoopRadius.lg),
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
              const SizedBox(width: ReLoopSpacing.md),
              Expanded(
                child: InkWell(
                  onTap: onWallet,
                  borderRadius: ReLoopRadius.brSm,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Halo, $firstName · Saldo tersedia',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: context.reloopMuted,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        formatRupiah(balance.available),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: context.reloopForeground,
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -.5,
                        ),
                      ),
                      if (showPoints) ...[
                        const SizedBox(height: 2),
                        Text(
                          '≈ ${formatThousands(points)} poin',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: context.reloopBrandText,
                                fontWeight: FontWeight.w700,
                              ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: ReLoopSpacing.md),
          Row(
            children: [
              Expanded(
                child: _SummaryAction(
                  icon: Icons.payments_outlined,
                  label: 'Cairkan',
                  onTap: onWallet,
                ),
              ),
              const SizedBox(width: ReLoopSpacing.sm),
              Expanded(
                child: _SummaryAction(
                  icon: Icons.history_rounded,
                  label: 'Riwayat',
                  onTap: onHistory,
                ),
              ),
            ],
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
      borderRadius: ReLoopRadius.brMd,
      child: Container(
        constraints: const BoxConstraints(minHeight: ReLoopA11y.minTouchTarget),
        padding: const EdgeInsets.symmetric(
          horizontal: ReLoopSpacing.md,
          vertical: ReLoopSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: context.reloopBrandSoft,
          borderRadius: ReLoopRadius.brMd,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: context.reloopBrandText, size: 20),
            const SizedBox(width: ReLoopSpacing.sm),
            Text(
              label,
              style: TextStyle(
                color: context.reloopBrandText,
                fontSize: 13,
                fontWeight: FontWeight.w700,
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
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              color: context.reloopForeground,
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
      // coverage:ignore-start
      QuickActionTone.green => (
        context.reloopBrandText,
        context.reloopBrandSoft,
      ),
      // coverage:ignore-end
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
