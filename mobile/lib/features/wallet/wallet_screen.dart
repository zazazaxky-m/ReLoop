import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../core/models/redemption.dart';
import '../../services/offline_service.dart';
import '../../shared/format.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import '../../theme/dimens.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  static const _cacheKey = 'wallet';

  WalletBalance? _balance;
  List<RewardLedgerEntry> _history = [];
  List<PayoutAccount> _accounts = [];
  List<Redemption> _redemptions = [];
  bool _isLoading = true;
  bool _isOffline = false;
  String? _error;
  bool _showPoints = false;
  int _pointsToRupiah = 0;

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  void _applyData(Map<String, dynamic> data) {
    _balance = WalletBalance.fromJson(data['balance'] as Map<String, dynamic>);
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
    _pointsToRupiah = (data['pointsToRupiah'] as num?)?.toInt() ?? 0;
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
      await OfflineService().cache(_cacheKey, data);

      setState(() {
        _applyData(data);
        _isLoading = false;
        _isOffline = false;
      });
    } catch (e) {
      final cached = OfflineService().get(_cacheKey);
      if (cached is Map<String, dynamic>) {
        setState(() {
          _applyData(cached);
          _isLoading = false;
          _isOffline = true;
        });
        return;
      }
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
        title: const Text('Nonaktifkan Akun?'),
        content: const Text('Akun pencairan ini akan dinonaktifkan.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: ReLoopColors.danger),
            child: const Text('Nonaktifkan'),
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
        const SnackBar(content: Text('Akun dinonaktifkan'), backgroundColor: ReLoopColors.success),
      );
      _loadWallet();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiClient.getErrorMessage(e)), backgroundColor: ReLoopColors.danger),
        );
      }
    }
  }

  Future<void> _cancelRedemption(String redemptionId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Batalkan Pencairan?'),
        content: const Text('Pencairan yang dibatalkan akan mengembalikan saldo ke akun Anda.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Tidak')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: ReLoopColors.danger),
            child: const Text('Ya, Batalkan'),
          ),
        ],
      ),
    );

    if (confirm != true || !mounted) return;

    try {
      final api = context.read<ApiClient>();
      await api.patch('/api/redemptions/$redemptionId', data: {'action': 'cancel'});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pencairan dibatalkan'), backgroundColor: ReLoopColors.success),
      );
      _loadWallet();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiClient.getErrorMessage(e)), backgroundColor: ReLoopColors.danger),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _loadWallet,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const SkeletonWallet();
    }

    if (_error != null) {
      return ReLoopErrorStateScrollable(message: _error!, onRetry: _loadWallet);
    }

    final balance = _balance!;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_isOffline) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: context.reloopTone('warning').bg,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: context.reloopTone('warning').border),
            ),
            child: Row(
              children: [
                Icon(Icons.cloud_off_rounded, size: 16, color: context.reloopTone('warning').text),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Menampilkan data tersimpan (offline). Tarik untuk menyegarkan.',
                    style: TextStyle(color: context.reloopTone('warning').text, fontSize: 12),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
        // Balance card
        Container(
          padding: const EdgeInsets.all(ReLoopSpacing.xxl),
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [ReLoopColors.brand600, ReLoopColors.brand700],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: ReLoopRadius.brLg,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Saldo Tersedia',
                style: TextStyle(color: Colors.white70, fontSize: 13),
              ),
              const SizedBox(height: ReLoopSpacing.sm),
              Text(
                balance.availableFormatted,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 36,
                  fontWeight: FontWeight.w800,
                ),
              ),
              if (_showPoints) ...[
                const SizedBox(height: ReLoopSpacing.xs),
                Text(
                  '${_points(balance.available, _pointsToRupiah)} poin tersedia',
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              const SizedBox(height: ReLoopSpacing.xl),
              Row(
                children: [
                  Expanded(child: _balanceItem('Pending', balance.pendingFormatted)),
                  const SizedBox(width: ReLoopSpacing.md),
                  Expanded(child: _balanceItem('Ditahan', formatRupiah(balance.reserved))),
                ],
              ),
              const SizedBox(height: ReLoopSpacing.lg),
              Row(
                children: [
                  Expanded(child: _balanceItem('Dicairkan', formatRupiah(balance.redeemed))),
                  const SizedBox(width: ReLoopSpacing.md),
                  Expanded(child: _balanceItem('Total', balance.totalEarnedFormatted)),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: ReLoopSpacing.xl),

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
                const ReLoopEmptyState(
                  icon: Icons.account_balance_outlined,
                  title: 'Belum ada akun pencairan',
                  description: 'Tambahkan rekening supaya kamu bisa mencairkan saldo.',
                  compact: true,
                )
              else
                ...List.generate(_accounts.length, (index) {
                  final account = _accounts[index];
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Row(
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: context.reloopBrandSoft,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Icon(Icons.account_balance,
                              color: context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand500),
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
                          icon: Icon(Icons.delete_outline, size: 20, color: context.reloopMutedSoft),
                          tooltip: 'Nonaktifkan Akun',
                          onPressed: () => _disableAccount(account.id),
                          constraints: const BoxConstraints(
                            minWidth: ReLoopA11y.minTouchTarget,
                            minHeight: ReLoopA11y.minTouchTarget,
                          ),
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
                ..._redemptions.map((r) => Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Row(
                        children: [
                          Container(
                            width: 40,
                            height: 40,
                            decoration: BoxDecoration(
                              color: context.reloopBrandSoft,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Icon(Icons.payment,
                                color: context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand500, size: 20),
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
                                  '${r.provider} · ${formatDateTimeIso(r.createdAt)}',
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
                              icon: const Icon(Icons.cancel_outlined, size: 20, color: ReLoopColors.danger),
                              tooltip: 'Batalkan',
                              onPressed: () => _cancelRedemption(r.id),
                              constraints: const BoxConstraints(
                                minWidth: ReLoopA11y.minTouchTarget,
                                minHeight: ReLoopA11y.minTouchTarget,
                              ),
                            ),
                        ],
                      ),
                    )),
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
                padding: _history.isEmpty ? EdgeInsets.zero : const EdgeInsets.all(ReLoopSpacing.lg),
                child: _history.isEmpty
                    ? const ReLoopEmptyState(
                        icon: Icons.receipt_long_outlined,
                        title: 'Belum ada transaksi',
                        description: 'Riwayat transaksimu akan muncul di sini.',
                        compact: true,
                      )
                    : ListView.separated(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        padding: EdgeInsets.zero,
                        itemCount: _history.length,
                        separatorBuilder: (context, index) => Divider(
                          color: context.reloopBorder,
                          height: 24,
                        ),
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
                                      ? (context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand500)
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
                                          '${entry.amount >= 0 ? "+" : ""}${formatRupiah(entry.amount.abs())}',
                                          style: TextStyle(
                                            fontWeight: FontWeight.w600,
                                            color: entry.amount >= 0
                                                ? (context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand700)
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
                                      )
                                    else
                                      Text(
                                        entry.displayLabel,
                                        style: TextStyle(
                                          color: context.reloopMutedSoft,
                                          fontSize: 12,
                                        ),
                                      ),
                                    if (entry.complianceMultiplier != null && entry.complianceMultiplier! < 1.0)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 2),
                                        child: Row(
                                          children: [
                                            const Icon(Icons.warning_amber_rounded, size: 14, color: ReLoopColors.warning),
                                            const SizedBox(width: ReLoopSpacing.xs),
                                            Expanded(
                                              child: Text(
                                                'Denda Kepatuhan: -${(100 - (entry.complianceMultiplier! * 100)).toInt()}% (Sblm: ${formatRupiah(entry.baseRewardAmount?.abs() ?? 0)})',
                                                style: const TextStyle(
                                                  color: ReLoopColors.warning,
                                                  fontSize: 12,
                                                  fontWeight: FontWeight.w600,
                                                ),
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                              Text(
                                formatDateTimeIso(entry.createdAt),
                                style: TextStyle(
                                  color: context.reloopMutedSoft,
                                  fontSize: 12,
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
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
        const SizedBox(height: ReLoopSpacing.xs),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w700,
            fontSize: 15,
          ),
        ),
      ],
    );
  }

  String _points(int amount, int pointsToRupiah) {
    if (pointsToRupiah <= 0) return '0';
    return formatThousands(amount ~/ pointsToRupiah);
  }
}
