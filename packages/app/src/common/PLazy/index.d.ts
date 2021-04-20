export class PLazy<ValueType> extends Promise<ValueType> {
  /**
	Create a `PLazy` promise from a promise-returning or async function.

	@example
	```
	import PLazy = require('p-lazy');

	const lazyPromise = new PLazy(resolve => {
		someHeavyOperation(resolve);
	});

	// `someHeavyOperation` is not yet called

	(async () => {
		await doSomethingFun;
		// `someHeavyOperation` is called
		console.log(await lazyPromise);
	})();
	```
	*/
  static from<ValueType>(fn: () => ValueType | PromiseLike<ValueType>): PLazy<ValueType>;
}
