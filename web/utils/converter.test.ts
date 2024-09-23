
import { formatDownloadSpeed } from './converter';
import { formatExtensionsName } from './converter';
import { formatTwoDigits } from './converter';

  test('formatDownloadSpeed_should_return_correct_output_when_input_is_undefined', () => {
    expect(formatDownloadSpeed(undefined)).toBe('0B/s');
  });


  test('formatExtensionsName_should_return_correct_output_for_string_with_janhq_and_dash', () => {
    expect(formatExtensionsName('@janhq/extension-name')).toBe('extension name');
  });


  test('formatTwoDigits_should_return_correct_output_for_single_digit_number', () => {
    expect(formatTwoDigits(5)).toBe('5.00');
  });


  test('formatDownloadSpeed_should_return_correct_output_for_gigabytes', () => {
    expect(formatDownloadSpeed(1500000000)).toBe('1.40GB/s');
  });


  test('formatDownloadSpeed_should_return_correct_output_for_megabytes', () => {
    expect(formatDownloadSpeed(1500000)).toBe('1.43MB/s');
  });


  test('formatDownloadSpeed_should_return_correct_output_for_kilobytes', () => {
    expect(formatDownloadSpeed(1500)).toBe('1.46KB/s');
  });
