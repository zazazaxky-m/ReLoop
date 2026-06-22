import 'package:flutter/material.dart';
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

  @override
  void dispose() {
    _emailCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _sent = true);
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
          const Text(
            'Reset Password',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: ReLoopColors.foreground),
          ),
          const SizedBox(height: 8),
          const Text(
            'Masukkan email Anda. Kami akan mengirimkan kode reset password.',
            style: TextStyle(color: ReLoopColors.muted, fontSize: 14),
          ),
          const SizedBox(height: 32),
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
          ReLoopButton(label: 'Kirim Kode Reset', onPressed: _submit, size: ReLoopButtonSize.lg),
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
        const Text(
          'Email Terkirim!',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: ReLoopColors.foreground),
        ),
        const SizedBox(height: 12),
        Text(
          'Kode reset password telah dikirim ke ${_emailCtrl.text}. Silakan cek inbox dan folder spam Anda.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: ReLoopColors.muted, fontSize: 14),
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
