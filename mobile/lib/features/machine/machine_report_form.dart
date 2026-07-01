import 'package:flutter/material.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../theme/colors.dart';

class MachineReportForm extends StatefulWidget {
  final String machineCode;

  const MachineReportForm({super.key, required this.machineCode});

  @override
  State<MachineReportForm> createState() => _MachineReportFormState();
}

class _MachineReportFormState extends State<MachineReportForm> {
  final _formKey = GlobalKey<FormState>();
  String? _issueType;
  final _descCtrl = TextEditingController();
  bool _isSubmitting = false;

  static const _issueTypes = [
    'PENUH',
    'RUSAK',
    'BAU',
    'KOTOR',
    'LAINNYA',
  ];

  String _issueLabel(String? type) {
    switch (type) {
      case 'PENUH': return 'Penuh/Tidak bisa menampung';
      case 'RUSAK': return 'Mesin rusak';
      case 'BAU': return 'Bau menyengat';
      case 'KOTOR': return 'Kotor/tidak terawat';
      case 'LAINNYA': return 'Lainnya';
      default: return '';
    }
  }

  @override
  void dispose() {
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_issueType == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pilih jenis masalah')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Fitur laporan mesin belum tersedia di backend saat ini.'),
          backgroundColor: ReLoopColors.warning,
        ),
      );
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Laporkan Masalah')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: context.reloopTone('warning').bg,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: context.reloopTone('warning').border),
                ),
                child: Row(
                  children: [
                    Icon(Icons.info_outline, color: context.reloopTone('warning').text, size: 20),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Pencatatan laporan mesin dari mobile belum didukung backend. '
                        'Gunakan kanal operasional lain untuk sementara.',
                        style: TextStyle(
                          color: context.reloopTone('warning').text,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Jenis Masalah',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: ReLoopColors.foreground,
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _issueType,
                decoration: const InputDecoration(
                  hintText: 'Pilih jenis masalah',
                  prefixIcon: Icon(Icons.warning_amber_rounded),
                ),
                items: _issueTypes.map((t) {
                  return DropdownMenuItem(value: t, child: Text(_issueLabel(t)));
                }).toList(),
                onChanged: (v) => setState(() => _issueType = v),
              ),
              const SizedBox(height: 20),
              TextFormField(
                controller: _descCtrl,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Deskripsi (opsional)',
                  hintText: 'Jelaskan masalah yang ditemukan...',
                  prefixIcon: Icon(Icons.description_outlined),
                ),
              ),
              const SizedBox(height: 32),
              ReLoopButton(
                label: 'Kirim Laporan',
                icon: Icons.send,
                onPressed: _isSubmitting ? null : _submit,
                isLoading: _isSubmitting,
                size: ReLoopButtonSize.lg,
              ),
              const SizedBox(height: 80),
            ],
          ),
        ),
      ),
    );
  }
}
