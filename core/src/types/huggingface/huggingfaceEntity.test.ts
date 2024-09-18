

  import { AllQuantizations } from './huggingfaceEntity';
  
  test('testAllQuantizationsArray', () => {
    expect(AllQuantizations).toEqual([
      'Q3_K_S',
      'Q3_K_M',
      'Q3_K_L',
      'Q4_K_S',
      'Q4_K_M',
      'Q5_K_S',
      'Q5_K_M',
      'Q4_0',
      'Q4_1',
      'Q5_0',
      'Q5_1',
      'IQ2_XXS',
      'IQ2_XS',
      'Q2_K',
      'Q2_K_S',
      'Q6_K',
      'Q8_0',
      'F16',
      'F32',
      'COPY',
    ]);
  });
