module.exports = [
  {
    name: 'counter',
    include: ['contracts/Counter.sol', 'contracts/AddressFactoryFixture.sol'],
  },
  { name: 'token', extraLeaves: ['TokenFixture'] },
  { name: 'reverts', include: ['contracts/RevertFixture.sol'] },
  { name: 'custom', include: ['src/CustomCounter.sol'] },
  { name: 'abi', include: ['contracts/AbiFixture.sol'] },
  { name: 'predictions', include: ['contracts/PredictionFixture.sol'] },
];
