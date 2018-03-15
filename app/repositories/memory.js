const assert = require('assert');
const levelup = require('levelup');
const levelgraph = require('levelgraph');
const levelgraphN3 = require('levelgraph-n3');
const Observable = require('rxjs/Observable').Observable;
require('rxjs/add/observable/from');
require('rxjs/add/observable/of');
require('rxjs/add/observable/merge');
require('rxjs/add/operator/map');
require('rxjs/add/operator/mergeMap');
require('rxjs/add/operator/count');
require('rxjs/add/operator/partition');
require('rxjs/add/operator/groupBy');
require('rxjs/add/operator/filter');
require('rxjs/add/operator/do');
require('rxjs/add/operator/distinct');
require('rxjs/add/operator/reduce');
require('rxjs/add/operator/toArray');
const {
  prop,
  xprod,
  pipe,
  propEq,
  not,
  unnest,
} = require('ramda');
const {
  range2LimitOffset
} = require('../utils/falcor');
const {
  fromNodeStream,
  takeExactly
} = require('../utils/rx.js');
const {
  getValue,
  getType,
  getLanguage,
  curie2uri,
  uri2curie,
  context: { rdf, skos }
} = require('../utils/rdf');


const makeMemoryTripleStore = (n3) => {
  const memdown = require('memdown');

  // memdown has a global cache
  // to ensure that each db instance is clean, clear the cache
  memdown.clearGlobalStore();

  const db = levelgraphN3(levelgraph(levelup('memoryGraph', { db: memdown })));

  if (n3) {
    db.n3.put(n3, () => {});
  }

  return db;
};

const cartesianProd = (a, b, c) => unnest(
  xprod(a, b)
    .map((list) => c.map((item) => ([...list, item])))
);


module.exports = ({ n3, context }) => {
  assert(typeof n3 === 'string', 'memory repository requires a n3 string on initialization');
  assert(typeof context === 'object', 'memory repository requires a context object on initialization');

  const db = makeMemoryTripleStore(n3);

  return {
    // TODO - should return triple length, preventing need for subsequent call to getPredicateLengths
    getTriples(subjects, predicates, ranges) {
      return Observable.from(cartesianProd(subjects, predicates, ranges))
        .mergeMap(([subject, predicate, range]) => {
          const { offset, limit, levelGraphLimit } = range2LimitOffset(range);

          const db$ = fromNodeStream(
            db.getStream({
              subject,
              predicate,
              limit: levelGraphLimit,
              offset
            })
          );

          return takeExactly(db$, limit)
            .map(({ object }, idx) => {
              return {
                subject,
                predicate,
                object,
                index: offset + idx,
                type: getType(object),
                lang: getLanguage(object)
              };
            });
        });
    },

    getPredicateLengths(subjects, predicates) {
      return Observable.of(...xprod(subjects, predicates))
        .mergeMap(([subject, predicate]) => {
          return fromNodeStream(
            db.getStream({
              subject: curie2uri(context, subject),
              predicate: curie2uri(context, predicate)
            })
          )
            .count()
            .map(length => ({
              subject: subject,
              predicate: predicate,
              length
            }));
        });
    },

    // TODO
    // getLabels()

    search(types, ranges) {
      return Observable.from(xprod(types, ranges))
        .mergeMap(([ type, range ]) => {
          const { offset, limit, levelGraphLimit } = range2LimitOffset(range);

          const db$ = fromNodeStream(
            db.getStream({
              predicate: `${rdf}type`,
              object: type,
              limit: levelGraphLimit,
              offset,
            })
          );

          return takeExactly(db$, limit)
            .map(({ subject }, idx) => ({
              type,
              collectionIdx: offset + idx,
              subject,
            }));
        });
    },

    searchCount(types) {
      return Observable.of(...types)
        .mergeMap((type) => {
          return fromNodeStream(
            db.getStream({
              predicate: `${rdf}type`,
              object: type
            })
          )
            .count()
            .map((length) => ({ type, length }));
        });
    },

    getTypes() {
      return fromNodeStream(
        db.searchStream([
          {
            predicate: `${rdf}type`,
            object: db.v('type')
          },
          {
            subject: db.v('type'),
            predicate: `${skos}prefLabel`,
            object: db.v('label')
          }
        ])
      )
        .map(({ type, label }) => ({
          uri: uri2curie(context, type),
          label: getValue(label),
          lang: getLanguage(label)
        }))
        .toArray();
    },

    getPredicates(types) {
      return Observable.of(...types)
        .mergeMap((type) => {
          return fromNodeStream(
            db.searchStream([
              {
                subject: db.v('subject'),
                predicate: `${rdf}type`,
                object: curie2uri(context, type)
              },
              {
                subject: db.v('subject'),
                predicate: db.v('predicate')
              },
              {
                subject: db.v('predicate'),
                predicate: `${skos}prefLabel`,
                object: db.v('label')
              }
            ], { limit: 100 })
          )
            .distinct(prop('predicate'))
            .filter(pipe(propEq('predicate', `${skos}prefLabel`), not()))
            .reduce((acc, { predicate, label }) => {
              acc.predicates.push({
                uri: uri2curie(context, predicate),
                label: getValue(label),
                lang: getLanguage(label)
              });
              return acc;
            }, { type, predicates: [] });
        });
    }
  };
};

// const Resource = () => ({
//   getOntologies(subjects, ranges) {
//     return Observable.of(...xprod(subjects, ranges))
//       .mergeMap(([subject, range]) => {
//         // This is more expensive than it should be b/c there's no way to do a groupBy in the query
//         // or to limit/offset the groups
//         // TODO figure out limit
//         return fromNodeStream(
//           db.getStream({ subject: curie2uri(context, subject), limit: 100 }) // limit is totally arbitrary, but will prevent us from pulling too large objects
//         )
//           .groupBy(prop('predicate'))
//           .filter((group, idx) => {
//             return idx >= range.from && idx <= range.to;
//           })
//           .mergeMap(({ key, groupSubject: group$ }, idx) => {
//             return group$
//               .count()
//               .map(count => ({
//                 subject: subject,
//                 ontologyIdx: range.from + idx,
//                 predicate: uri2curie(context, key),
//                 count
//               }));
//           });
//       });
//   },

//   getOntologiesLength(subjects) {
//     return Observable.of(...subjects)
//       .mergeMap((subject) => {
//         return fromNodeStream(
//           db.getStream({ subject: curie2uri(context, subject) })
//         )
//           .groupBy(prop('predicate'))
//           .count()
//           .map(count => ({ subject, length: count }));
//       });
//   }
// });

// const Collection = (db, context) => ({
//   searchOntology(collections, ranges) {
//     return Observable.of(...xprod(collections, ranges))
//       .mergeMap(([collection, range]) => {
//         return fromNodeStream(
//           db.searchStream([
//             { subject: db.v('subject'), predicate: `${rdf}type`, object: curie2uri(context, collection) },
//             { subject: db.v('subject'), predicate: db.v('predicate') }
//           ], { limit: 100 })
//         )
//           .groupBy(prop('predicate'))
//           .filter((group, idx) => {
//             return idx >= range.from && idx <= range.to;
//           })
//           .mergeMap(({ key, groupSubject: group$ }, idx) => {
//             return group$
//               .count()
//               .map(count => ({ collection, ontologyIdx: range.from + idx, predicate: uri2curie(context, key), count }));
//           });
//       });
//   },

//   searchOntologyCount(collections) {
//     return Observable.of(...collections)
//       .mergeMap((collection) => {
//         return fromNodeStream(
//           db.searchStream([
//             { subject: db.v('subject'), predicate: `${rdf}type`, object: curie2uri(context, collection), limit: 1, offset: 2 },
//             { subject: db.v('subject'), predicate: db.v('predicate') }
//           ], { limit: 100 })
//         )
//           .groupBy(prop('predicate'))
//           .count()
//           .map(count => ({ collection, length: count }));
//       });
//   },
// });
