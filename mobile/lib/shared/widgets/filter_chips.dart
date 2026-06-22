import 'package:flutter/material.dart';
import '../../theme/colors.dart';

class ReLoopFilterChips extends StatelessWidget {
  final List<String> options;
  final String? selected;
  final ValueChanged<String?> onSelected;
  final String? label;

  const ReLoopFilterChips({
    super.key,
    required this.options,
    this.selected,
    required this.onSelected,
    this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null) ...[
          Text(
            label!,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: ReLoopColors.muted),
          ),
          const SizedBox(height: 8),
        ],
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            _buildChip(null, 'Semua'),
            ...options.map((o) => _buildChip(o, o)),
          ],
        ),
      ],
    );
  }

  Widget _buildChip(String? value, String label) {
    final isSelected = value == selected;
    return GestureDetector(
      onTap: () => onSelected(value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? ReLoopColors.brand500 : ReLoopColors.background,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: isSelected ? ReLoopColors.brand500 : ReLoopColors.border),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? Colors.white : ReLoopColors.muted,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
