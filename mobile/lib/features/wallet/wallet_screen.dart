import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../core/models/redemption.dart';
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
  List<Redemption> _redemptions = [];
  bool _showPoints = false;
  int _pointsToRupiah = 1;
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
        _balance = WalletBalance.fromJson(
          data['balance'] as Map<String, dynamic>,
        );
        _history = (data['history'] as List? ?? [])
            .map((e) => RewardLedgerEntry.fromJson(e as Map<String, dynamic>))
            .toList();
        _accounts = (data['payoutAccounts'] as List? ?? [])
            .map((e) => PayoutAccount.fromJson(e as Map<String, dynamic>))
            .toList();
        _redemptions = (data['redemptions'] as List? ?? [])
            .map((e) => Redemption.fromJson(e as Map<String, dynamic>))
            .toList();
        _showPoints = data['isTravelAgent'] as bool? ?? false;
        _pointsToRupiah = (data['pointsToRupiah'] as num?)?.toInt() ?? 1;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  Future<void> _disableAccount(String accountId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Nonaktifkan Akun?'),
        content: Text('Akun pencairan ini akan dinonaktifkan.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Batal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: ReLoopColors.danger),
            child: Text('Nonaktifkan'),
          ),
        ],
      ),
    );

    if (confirm != true || !mounted) return;

    try {
      final api = context.read<ApiClient>();
      await api.delete('/api/payout-accounts/$accountId');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Akun dinonaktifkan'),
          backgroundColor: ReLoopColors.success,
        ),
      );
      _loadWallet();
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

  Future<void> _cancelRedemption(String redemptionId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Batalkan Pencairan?'),
        content: Text(
          'Pencairan yang dibatalkan akan mengembalikan saldo ke akun Anda.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Tidak'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: ReLoopColors.danger),
            child: Text('Ya, Batalkan'),
          ),
        ],
      ),
    );

    if (confirm != true || !mounted) return;

    try {
      final api = context.read<ApiClient>();
      await api.patch(
        '/api/redemptions/$redemptionId',
        data: {'action': 'cancel'},
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Pencairan dibatalkan'),
          backgroundColor: ReLoopColors.success,
        ),
      );
      _loadWallet();
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RefreshIndicator(onRefresh: _loadWallet, child: _buildBody()),
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
            Icon(Icons.cloud_off, size: 48, color: context.reloopMutedSoft),
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: context.reloopMuted)),
            const SizedBox(height: 12),
            TextButton(onPressed: _loadWallet, child: Text('Coba Lagi')),
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
              Text(
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
              if (_showPoints) ...[
                const SizedBox(height: 6),
                Text(
                  '${_points(balance.available, _pointsToRupiah)} poin tersedia',
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _balanceItem('Pending', balance.pendingFormatted),
                  _balanceItem('Direservasi', 'Rp ${_fmt(balance.reserved)}'),
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
        ReLoopCard(
          padding: EdgeInsets.zero,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ReLoopCardHeader(
                child: Row(
                  children: [
                    const Expanded(
                      child: ReLoopCardTitle(title: 'Rekening Pencairan'),
                    ),
                    ReLoopButton(
                      label: 'Tambah',
                      icon: Icons.add,
                      variant: ReLoopButtonVariant.outline,
                      size: ReLoopButtonSize.sm,
                      expanded: false,
                      onPressed: () => context.push('/wallet/add-account'),
                    ),
                  ],
                ),
              ),
              if (_accounts.isEmpty)
                Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(
                    child: Text(
                      'Belum ada akun pencairan.',
                      style: TextStyle(
                        color: context.reloopMutedSoft,
                        fontSize: 13,
                      ),
                    ),
                  ),
                )
              else
                ...List.generate(_accounts.length, (index) {
                  final account = _accounts[index];
                  return Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: context.reloopBrandSoft,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Icon(
                            Icons.account_balance,
                            color: context.isDarkMode
                                ? ReLoopColors.brand400
                                : ReLoopColors.brand500,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                account.provider,
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: context.reloopForeground,
                                  fontSize: 14,
                                ),
                              ),
                              Text(
                                account.accountIdentifier,
                                style: TextStyle(
                                  color: context.reloopMutedSoft,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                        StatusBadge(statusKey: account.status),
                        IconButton(
                          icon: Icon(
                            Icons.delete_outline,
                            size: 18,
                            color: context.reloopMutedSoft,
                          ),
                          tooltip: 'Nonaktifkan Akun',
                          onPressed: () => _disableAccount(account.id),
                        ),
                      ],
                    ),
                  );
                }),
              const SizedBox(height: 8),
            ],
          ),
        ),
        const SizedBox(height: 20),

        // Redemption history
        if (_redemptions.isNotEmpty) ...[
          ReLoopCard(
            padding: EdgeInsets.zero,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const ReLoopCardHeader(
                  child: ReLoopCardTitle(title: 'Riwayat Pencairan'),
                ),
                ..._redemptions.map(
                  (r) => Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
                            color: context.reloopBrandSoft,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Icon(
                            Icons.payment,
                            color: context.isDarkMode
                                ? ReLoopColors.brand400
                                : ReLoopColors.brand500,
                            size: 20,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                r.amountFormatted,
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: context.reloopForeground,
                                  fontSize: 14,
                                ),
                              ),
                              Text(
                                '${r.provider} · ${_formatDate(r.createdAt)}',
                                style: TextStyle(
                                  color: context.reloopMutedSoft,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                        StatusBadge(statusKey: r.status),
                        if (r.status == 'REQUESTED')
                          IconButton(
                            icon: const Icon(
                              Icons.cancel_outlined,
                              size: 16,
                              color: ReLoopColors.danger,
                            ),
                            tooltip: 'Batalkan',
                            onPressed: () => _cancelRedemption(r.id),
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(
                              minWidth: 32,
                              minHeight: 32,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 8),
              ],
            ),
          ),
          const SizedBox(height: 20),
        ],

        // History
        ReLoopCard(
          padding: EdgeInsets.zero,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const ReLoopCardHeader(
                child: ReLoopCardTitle(title: 'Riwayat Transaksi'),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: _history.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          child: Column(
                            children: [
                              Icon(
                                Icons.receipt_long_outlined,
                                size: 40,
                                color: context.reloopMutedSoft,
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Belum ada transaksi',
                                style: TextStyle(
                                  color: context.reloopMutedSoft,
                                ),
                              ),
                            ],
                          ),
                        ),
                      )
                    : ListView.separated(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        padding: EdgeInsets.zero,
                        itemCount: _history.length,
                        separatorBuilder: (context, index) =>
                            Divider(color: context.reloopBorder, height: 24),
                        itemBuilder: (context, index) {
                          final entry = _history[index];
                          return Row(
                            children: [
                              Container(
                                width: 40,
                                height: 40,
                                decoration: BoxDecoration(
                                  color: entry.amount >= 0
                                      ? context.reloopBrandSoft
                                      : context.reloopTone('danger').bg,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Icon(
                                  entry.amount >= 0
                                      ? Icons.add_circle_outline
                                      : Icons.remove_circle_outline,
                                  color: entry.amount >= 0
                                      ? (context.isDarkMode
                                            ? ReLoopColors.brand400
                                            : ReLoopColors.brand500)
                                      : context.reloopTone('danger').text,
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
                                                ? (context.isDarkMode
                                                      ? ReLoopColors.brand400
                                                      : ReLoopColors.brand700)
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
                                        style: TextStyle(
                                          color: context.reloopMutedSoft,
                                          fontSize: 12,
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                              Text(
                                _formatDate(entry.createdAt),
                                style: TextStyle(
                                  color: context.reloopMutedSoft,
                                  fontSize: 11,
                                ),
                              ),
                            ],
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 80),
      ],
    );
  }

  Widget _balanceItem(String label, String value) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(color: Colors.white60, fontSize: 11),
        ),
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

  String _points(int amount, int pointsToRupiah) {
    if (pointsToRupiah <= 0) return '0';
    final points = amount ~/ pointsToRupiah;
    return points.toString().replaceAllMapped(
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
