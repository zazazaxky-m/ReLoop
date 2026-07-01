import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../theme/colors.dart';

class PayoutAccountForm extends StatefulWidget {
  const PayoutAccountForm({super.key});

  @override
  State<PayoutAccountForm> createState() => _PayoutAccountFormState();
}

class _PayoutAccountFormState extends State<PayoutAccountForm> {
  final _formKey = GlobalKey<FormState>();
  final _providerCtrl = TextEditingController();
  final _numberCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  String? _selectedProvider;
  bool _isSaving = false;

  static const _providers = ['BANK', 'GOPAY', 'OVO', 'DANA', 'SHOPEEPAY'];

  String get _providerLabel {
    switch (_selectedProvider) {
      case 'BANK':
        return 'Nomor Rekening';
      case 'GOPAY':
      case 'OVO':
      case 'DANA':
      case 'SHOPEEPAY':
        return 'Nomor HP Terdaftar';
      default:
        return 'Nomor Akun';
    }
  }

  @override
  void dispose() {
    _providerCtrl.dispose();
    _numberCtrl.dispose();
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);

    try {
      final api = context.read<ApiClient>();
      await api.post(
        '/api/payout-accounts',
        data: {
          'provider': _selectedProvider,
          'accountIdentifier': _numberCtrl.text.trim(),
          'accountName': _nameCtrl.text.trim(),
        },
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Akun pencairan berhasil ditambahkan'),
          backgroundColor: ReLoopColors.success,
        ),
      );
      Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiClient.getErrorMessage(e)),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Tambah Akun Pencairan')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Pilih Provider',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: context.reloopForeground,
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _selectedProvider,
                decoration: const InputDecoration(
                  hintText: 'Pilih provider',
                  prefixIcon: Icon(Icons.account_balance),
                ),
                items: _providers.map((p) {
                  return DropdownMenuItem(value: p, child: Text(p));
                }).toList(),
                onChanged: (v) {
                  setState(() {
                    _selectedProvider = v;
                    _numberCtrl.clear();
                  });
                },
                validator: (v) {
                  if (v == null || v.isEmpty) return 'Pilih provider';
                  return null;
                },
              ),
              const SizedBox(height: 20),
              TextFormField(
                controller: _numberCtrl,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: _providerLabel,
                  hintText: _selectedProvider == 'BANK'
                      ? '1234567890'
                      : '08123456789',
                  prefixIcon: Icon(
                    _selectedProvider == 'BANK'
                        ? Icons.credit_card
                        : Icons.phone_outlined,
                  ),
                ),
                validator: (v) {
                  if (v == null || v.trim().isEmpty) return 'Wajib diisi';
                  return null;
                },
              ),
              const SizedBox(height: 20),
              TextFormField(
                controller: _nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'Nama Pemilik Akun',
                  hintText: 'Nama sesuai rekening/wallet',
                  prefixIcon: Icon(Icons.person_outline),
                ),
                validator: (v) {
                  if (v == null || v.trim().length < 2)
                    return 'Nama minimal 2 karakter';
                  return null;
                },
              ),
              const SizedBox(height: 32),
              ReLoopButton(
                label: 'Simpan Akun',
                onPressed: _isSaving ? null : _save,
                isLoading: _isSaving,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
