module.exports = [
  {
    name: 'counter',
    include: ['contracts/Counter.sol', 'contracts/AddressFactoryFixture.sol'],
  },
  { name: 'token', extraLeaves: ['TokenFixture'] },
  { name: 'reverts', include: ['contracts/RevertFixture.sol'] },
];
