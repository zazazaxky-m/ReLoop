import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../theme/colors.dart';

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _emailCtrl = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _sent = false;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _emailCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      // Always shows the same success state regardless of whether the email is
      // registered — the backend deliberately returns a generic response to
      // prevent account enumeration.
      await context.read<ApiClient>().post(
        '/api/auth/forgot-password',
        data: {'email': _emailCtrl.text.trim()},
      );
      if (mounted) setState(() => _sent = true);
    } catch (error) {
      if (mounted) {
        setState(() => _error = ApiClient.getErrorMessage(error));
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Lupa Password')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: _sent ? _buildSuccess() : _buildForm(),
        ),
      ),
    );
  }

  Widget _buildForm() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.lock_reset, size: 56, color: ReLoopColors.brand500),
          const SizedBox(height: 20),
          Text(
              'Reset Password',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: context.reloopForeground),
            ),
          const SizedBox(height: 8),
          Text(
              'Masukkan email Anda. Kami akan mengirimkan tautan untuk mengatur ulang kata sandi.',
              style: TextStyle(color: context.reloopMuted, fontSize: 14),
            ),
          const SizedBox(height: 32),
          if (_error != null) ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: ReLoopColors.danger.withValues(alpha: .1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: ReLoopColors.danger.withValues(alpha: .35),
                ),
              ),
              child: Text(
                _error!,
                style: const TextStyle(color: ReLoopColors.danger, fontSize: 13),
              ),
            ),
            const SizedBox(height: 16),
          ],
          TextFormField(
            controller: _emailCtrl,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(
              labelText: 'Email',
              hintText: 'contoh@email.com',
              prefixIcon: Icon(Icons.email_outlined),
            ),
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Email wajib diisi';
              if (!RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$').hasMatch(v.trim())) return 'Format email tidak valid';
              return null;
            },
          ),
          const SizedBox(height: 24),
          ReLoopButton(
            label: 'Kirim Tautan Reset',
            onPressed: _submit,
            isLoading: _submitting,
            size: ReLoopButtonSize.lg,
          ),
        ],
      ),
    );
  }

  Widget _buildSuccess() {
    return Column(
      children: [
        const SizedBox(height: 40),
        const Icon(Icons.mark_email_read, size: 64, color: ReLoopColors.brand500),
        const SizedBox(height: 24),
        Text(
            'Email Terkirim!',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: context.reloopForeground),
          ),
        const SizedBox(height: 12),
        Text(
          'Jika ${_emailCtrl.text} terdaftar, kami telah mengirimkan tautan reset kata sandi. Silakan cek inbox dan folder spam Anda.',
          textAlign: TextAlign.center,
          style: TextStyle(color: context.reloopMuted, fontSize: 14),
        ),
        const SizedBox(height: 32),
        ReLoopButton(
          label: 'Kembali ke Login',
          variant: ReLoopButtonVariant.outline,
          onPressed: () => Navigator.pop(context),
        ),
      ],
    );
  }
}
