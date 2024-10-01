

  import * as huggingfaceEntity from './huggingfaceEntity';
  import * as index from './index';
  
  test('test_exports_from_huggingfaceEntity', () => {
    expect(index).toEqual(huggingfaceEntity);
  });
