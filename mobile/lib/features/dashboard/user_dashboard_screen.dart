import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../core/auth_provider.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/quick_action.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../shared/widgets/reloop_button.dart';
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
      final data = response.data;

      if (data is! Map<String, dynamic>) {
        throw Exception('Response format tidak valid (expected Map, got ${data.runtimeType})');
      }

      _dashboard = UserDashboard.fromJson(data);

      setState(() {
        _isLoading = false;
      });
    } catch (e, stack) {
      debugPrint('Dashboard error: $e\n$stack');
      setState(() {
        _error = ApiClient.getErrorMessage(e, includeDetails: true);
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
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
    final auth = context.watch<AuthProvider>();
    final userName = auth.user?.name ?? 'User';
    final firstName = userName.split(' ').first;
    final userEmail = auth.user?.email ?? '';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Greeting Page Header
        Container(
          padding: const EdgeInsets.only(bottom: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Halo, $firstName!',
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: ReLoopColors.foreground,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Pantau aktivitas setor, saldo reward, dan program yang sedang berlangsung.',
                style: TextStyle(
                  fontSize: 12.5,
                  color: ReLoopColors.muted,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 16),
              ReLoopButton(
                label: 'Scan Mesin',
                icon: Icons.qr_code_scanner,
                expanded: true,
                onPressed: () => context.push('/scan'),
              ),
            ],
          ),
        ),

        Row(
          children: [
            Expanded(
              child: MetricCard(
                label: 'Saldo tersedia',
                value: d.balance.availableFormatted,
                hint: d.balance.pending > 0
                    ? '+${_fmtCurrency(d.balance.pending)} menunggu tinjauan'
                    : null,
                icon: Icons.account_balance_wallet,
                tone: MetricTone.green,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: MetricCard(
                label: 'Total diperoleh',
                value: _fmtCurrency(d.balance.totalEarned),
                icon: Icons.savings_outlined,
                tone: MetricTone.amber,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        MetricCard(
          label: 'Program aktif',
          value: d.campaigns.where((c) => c.status == 'ACTIVE').length.toString(),
          icon: Icons.campaign,
          tone: MetricTone.blue,
        ),

        const SizedBox(height: 16),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.55,
          children: [
            QuickAction(
              icon: Icons.qr_code_scanner,
              title: 'Scan mesin',
              description: 'Mulai sesi setor dengan QR.',
              onTap: () => context.push('/scan'),
            ),
            QuickAction(
              icon: Icons.map,
              title: 'Cari mesin',
              description: 'Lihat lokasi dan kapasitas.',
              color: ReLoopColors.accent,
              onTap: () => context.push('/map'),
            ),
            QuickAction(
              icon: Icons.account_balance_wallet,
              title: 'Dompet',
              description: 'Kelola saldo dan pencairan.',
              color: ReLoopColors.statusFull,
              onTap: () => context.push('/wallet'),
            ),
            QuickAction(
              icon: Icons.campaign,
              title: 'Program',
              description: 'Lihat program yang tersedia.',
              color: ReLoopColors.info,
              onTap: () => context.push('/campaigns'),
            ),
          ],
        ),

        const SizedBox(height: 24),
        _sectionHeader('Sesi setor terakhir'),
        const SizedBox(height: 8),
        ..._buildSessions(d),

        const SizedBox(height: 24),
        _sectionHeader('Campaign untuk Anda'),
        const SizedBox(height: 8),
        ..._buildCampaigns(d, userEmail),

        const SizedBox(height: 24),
        _sectionHeader('Riwayat reward'),
        const SizedBox(height: 8),
        ..._buildLedger(d),

        const SizedBox(height: 80),
      ],
    );
  }

  Widget _sectionHeader(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: ReLoopColors.foreground,
      ),
    );
  }

  List<Widget> _buildSessions(UserDashboard d) {
    if (d.recentSessions.isEmpty) {
      return [
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: Center(
            child: Text(
              'Belum ada sesi setor.',
              style: TextStyle(color: ReLoopColors.mutedSoft, fontSize: 13),
            ),
          ),
        ),
      ];
    }

    return d.recentSessions.take(5).map((s) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: ReLoopCard(
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: ReLoopColors.mintSoft,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.recycling,
                    color: ReLoopColors.brand500, size: 18),
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
                        fontSize: 13,
                      ),
                    ),
                    Text(
                      _formatDate(s.startedAt),
                      style: const TextStyle(
                        color: ReLoopColors.mutedSoft,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              StatusBadge(statusKey: s.status),
            ],
          ),
        ),
      );
    }).toList();
  }

  List<Widget> _buildLedger(UserDashboard d) {
    if (d.recentLedger.isEmpty) {
      return [
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: Center(
            child: Text(
              'Belum ada riwayat reward.',
              style: TextStyle(color: ReLoopColors.mutedSoft, fontSize: 13),
            ),
          ),
        ),
      ];
    }

    return d.recentLedger.take(5).map((entry) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: ReLoopCard(
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: entry.amount >= 0
                      ? ReLoopColors.brand50
                      : ReLoopColors.tones['danger']!.bg,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  Icons.recycling,
                  color: entry.amount >= 0
                      ? ReLoopColors.brand500
                      : ReLoopColors.danger,
                  size: 18,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      entry.wasteTypeName ?? entry.entryType,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        color: ReLoopColors.foreground,
                        fontSize: 13,
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
              Text(
                '${entry.amount >= 0 ? "+" : ""}${_fmtCurrencyShort(entry.amount)}',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: entry.amount >= 0
                      ? ReLoopColors.brand700
                      : ReLoopColors.danger,
                  fontSize: 14,
                ),
              ),
            ],
          ),
        ),
      );
    }).toList();
  }

  String _fmtCurrency(int amount) {
    final formatted = amount.toString().replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]}.',
    );
    return 'Rp $formatted';
  }

  String _fmtCurrencyShort(int amount) {
    final formatted = amount.toString().replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]}.',
    );
    return 'Rp $formatted';
  }

  String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return iso;
    }
  }

  bool _isCampaignEligible(CampaignInfo c, String email) {
    if (c.allowedEmailDomains == null || c.allowedEmailDomains!.isEmpty) {
      return true;
    }
    final domain = email.split('@').last.toLowerCase();
    return c.allowedEmailDomains!.any((d) => d.toLowerCase() == domain);
  }

  List<Widget> _buildCampaigns(UserDashboard d, String email) {
    final eligibleCampaigns = d.campaigns.where((c) {
      return c.status == 'ACTIVE' && _isCampaignEligible(c, email);
    }).toList();

    if (eligibleCampaigns.isEmpty) {
      return [
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: Center(
            child: Text(
              'Tidak ada campaign aktif saat ini.',
              style: TextStyle(color: ReLoopColors.mutedSoft, fontSize: 13),
            ),
          ),
        ),
      ];
    }

    return eligibleCampaigns.take(4).map((campaign) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: ReLoopCard(
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: ReLoopColors.brand50,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: ReLoopColors.brand100),
                ),
                child: const Icon(Icons.campaign, color: ReLoopColors.brand600, size: 18),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      campaign.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: ReLoopColors.brand800,
                        fontSize: 13,
                      ),
                    ),
                    Text(
                      campaign.organizationName ?? 'Organisasi',
                      style: const TextStyle(
                        color: ReLoopColors.muted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    }).toList();
  }
}
