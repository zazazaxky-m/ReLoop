import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  WalletBalance? _balance;
  List<RewardLedgerEntry> _history = [];
  List<PayoutAccount> _accounts = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  Future<void> _loadWallet() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      final response = await api.get('/api/wallet');
      final data = response.data as Map<String, dynamic>;

      setState(() {
        _balance = WalletBalance.fromJson(data['balance'] as Map<String, dynamic>);
        _history = (data['history'] as List? ?? [])
            .map((e) => RewardLedgerEntry.fromJson(e as Map<String, dynamic>))
            .toList();
        _accounts = (data['payoutAccount'] != null)
            ? [PayoutAccount.fromJson(data['payoutAccount'] as Map<String, dynamic>)]
            : [];
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
      appBar: AppBar(title: const Text('Dompet')),
      body: RefreshIndicator(
        onRefresh: _loadWallet,
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
            TextButton(onPressed: _loadWallet, child: const Text('Coba Lagi')),
          ],
        ),
      );
    }

    final balance = _balance!;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Balance card
        Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [ReLoopColors.brand600, ReLoopColors.brand700],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Saldo Tersedia',
                style: TextStyle(color: Colors.white70, fontSize: 13),
              ),
              const SizedBox(height: 8),
              Text(
                balance.availableFormatted,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 36,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _balanceItem('Pending', balance.pendingFormatted),
                  _balanceItem('Dicairkan', 'Rp ${_fmt(balance.redeemed)}'),
                  _balanceItem('Total', balance.totalEarnedFormatted),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),

        // Redemption quick action
        ReLoopButton(
          label: 'Cairkan Saldo',
          icon: Icons.payment,
          variant: ReLoopButtonVariant.outline,
          onPressed: () => context.push('/wallet/redemption'),
        ),
        const SizedBox(height: 20),

        // Accounts
        if (_accounts.isNotEmpty) ...[
          const Text(
            'Rekening Pencairan',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: ReLoopColors.foreground,
            ),
          ),
          const SizedBox(height: 8),
          ReLoopCard(
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: ReLoopColors.brand50,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.account_balance,
                      color: ReLoopColors.brand500),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _accounts.first.provider,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          color: ReLoopColors.foreground,
                          fontSize: 14,
                        ),
                      ),
                      Text(
                        _accounts.first.accountIdentifier,
                        style: const TextStyle(
                          color: ReLoopColors.mutedSoft,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
                StatusBadge(statusKey: _accounts.first.status),
              ],
            ),
          ),
          const SizedBox(height: 20),
        ],

        // History
        const Text(
          'Riwayat Transaksi',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: ReLoopColors.foreground,
          ),
        ),
        const SizedBox(height: 8),
        if (_history.isEmpty)
          ReLoopCard(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    const Icon(Icons.receipt_long_outlined,
                        size: 40, color: ReLoopColors.mutedSoft),
                    const SizedBox(height: 8),
                    const Text(
                      'Belum ada transaksi',
                      style: TextStyle(color: ReLoopColors.mutedSoft),
                    ),
                  ],
                ),
              ),
            ),
          )
        else
          ..._history.map((entry) => Padding(
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
                            if (entry.wasteTypeName != null)
                              Text(
                                entry.wasteTypeName!,
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
        const SizedBox(height: 80),
      ],
    );
  }

  Widget _balanceItem(String label, String value) {
    return Column(
      children: [
        Text(label, style: const TextStyle(color: Colors.white60, fontSize: 11)),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w700,
            fontSize: 14,
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
      return '${dt.day}/${dt.month}';
    } catch (_) {
      return '';
    }
  }
}
