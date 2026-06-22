import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'api_client.dart';

final _money = NumberFormat.currency(
  locale: 'id_ID',
  symbol: 'Rp',
  decimalDigits: 0,
);

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  Map<String, dynamic>? data;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final result = await widget.api.get('/api/wallet');
      if (mounted) setState(() => data = result);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  Future<void> addAccount() async {
    final identifier = TextEditingController();
    final name = TextEditingController();
    var provider = 'GOPAY';
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Tambah akun pencairan'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: provider,
                items:
                    const [
                          'GOPAY',
                          'OVO',
                          'DANA',
                          'SHOPEEPAY',
                          'LINKAJA',
                          'BANK',
                          'OTHER',
                        ]
                        .map(
                          (value) => DropdownMenuItem(
                            value: value,
                            child: Text(value),
                          ),
                        )
                        .toList(),
                onChanged: (value) => setDialogState(() => provider = value!),
                decoration: const InputDecoration(labelText: 'Provider'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: identifier,
                decoration: const InputDecoration(
                  labelText: 'Nomor akun / rekening',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: name,
                decoration: const InputDecoration(labelText: 'Nama pemilik'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Batal'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Simpan'),
            ),
          ],
        ),
      ),
    );
    if (result == true) {
      try {
        await widget.api.post('/api/payout-accounts', {
          'provider': provider,
          'accountIdentifier': identifier.text.trim(),
          'accountName': name.text.trim(),
        });
        await load();
      } on ApiException catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(e.message)));
        }
      }
    }
    identifier.dispose();
    name.dispose();
  }

  Future<void> redeem(Map<String, dynamic> account) async {
    final amount = TextEditingController();
    final approved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Ajukan pencairan'),
        content: TextField(
          controller: amount,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: 'Jumlah',
            helperText: 'Minimum ${_money.format(data!['minRedemption'])}',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Ajukan'),
          ),
        ],
      ),
    );
    if (approved == true) {
      try {
        await widget.api.post('/api/redemptions', {
          'amount': int.tryParse(amount.text) ?? 0,
          'payoutAccountId': account['id'],
          'idempotencyKey': 'mobile-${DateTime.now().millisecondsSinceEpoch}',
        });
        await load();
      } on ApiException catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(e.message)));
        }
      }
    }
    amount.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (data == null) {
      return error == null
          ? const Center(child: CircularProgressIndicator())
          : Center(child: Text(error!));
    }
    final balance = data!['balance'] as Map<String, dynamic>;
    final history = data!['history'] as List;
    final account = data!['payoutAccount'] as Map<String, dynamic>?;
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Card(
            color: Theme.of(context).colorScheme.primaryContainer,
            child: Padding(
              padding: const EdgeInsets.all(22),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Saldo tersedia'),
                  Text(
                    _money.format(balance['available']),
                    style: const TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${_money.format(balance['pending'])} masih menunggu tinjauan',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: account == null
                  ? FilledButton.icon(
                      onPressed: addAccount,
                      icon: const Icon(Icons.add_card),
                      label: const Text('Tambah akun pencairan'),
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Akun pencairan',
                          style: TextStyle(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '${account['provider']} • ${account['accountIdentifier']}',
                        ),
                        Text(account['accountName']?.toString() ?? ''),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: () => redeem(account),
                          icon: const Icon(Icons.payments_outlined),
                          label: const Text('Cairkan reward'),
                        ),
                      ],
                    ),
            ),
          ),
          const SizedBox(height: 18),
          const Text(
            'Riwayat reward',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          for (final raw in history)
            ListTile(
              leading: const CircleAvatar(child: Icon(Icons.paid_outlined)),
              title: Text((raw as Map)['entryType'].toString()),
              subtitle: Text('${raw['status']} • ${raw['createdAt']}'),
              trailing: Text(
                _money.format(raw['amount']),
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
        ],
      ),
    );
  }
}
