module.exports = [
  {
    name: 'counter',
    include: ['contracts/Counter.sol', 'contracts/AddressFactoryFixture.sol'],
  },
  { name: 'token', extraLeaves: ['TokenFixture'] },
];
