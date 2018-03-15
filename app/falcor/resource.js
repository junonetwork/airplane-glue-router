const Observable = require('rxjs/Observable').Observable;
require('rxjs/add/observable/from');
require('rxjs/add/observable/of');
require('rxjs/add/operator/map');
require('rxjs/add/operator/mergeMap');
const {
  $atom,
  $ref,
  atomMetadata
} = require('../utils/falcor');
const {
  groupUrisByRepo
} = require('../utils/repository');
const {
  getValue,
  curie2uri,
  uri2curie,
} = require('../utils/rdf');


module.exports = (repos, context) => ([
  {
    route: 'resource[{keys:subjects}][{keys:predicates}][{ranges:ranges}]',
    get({ subjects, predicates, ranges }) {
      return Observable.from(
        groupUrisByRepo(repos)(subjects)
      )
        .mergeMap(({ repository, uris }) => (
          repository.getTriples(
            uris.map((subject) => curie2uri(context, subject)),
            predicates.map((predicate) => curie2uri(context, predicate)),
            ranges
          ))
        )
        .map(({ subject, predicate, index, object, type, lang }) => {
          if (object === undefined) {
            return {
              path: ['resource', uri2curie(context, subject), uri2curie(context, predicate), index],
              value: null
            };
          } else if (type === 'relationship') {
            return {
              path: ['resource', uri2curie(context, subject), uri2curie(context, predicate), index],
              value: $ref(['resource', uri2curie(context, getValue(object))])
            };
          }

          return {
            path: ['resource', uri2curie(context, subject), uri2curie(context, predicate), index],
            value: $atom(
              uri2curie(context, getValue(object)),
              atomMetadata(
                uri2curie(context, type),
                lang
              )
            )
          };
        });
    }
  },
  {
    // request singleton predicate
    // WARNING: This could throw off the cache, e.g. user requests ['resource', <uri>, <predicate>, <range>],
    // then requests ['resource', <uri>, <predicate>].  They will overwrite the range w/ a single value good/bad?
    // TODO - perhaps the correct approach is to whitelist singleton predicates
    route: 'resource[{keys:subjects}][{keys:predicates}]',
    get({ subjects, predicates }) {
      return Observable.from(
        groupUrisByRepo(repos)(subjects)
      )
        .mergeMap(({ repository, uris }) => (
          repository.getTriples(
            uris.map((subject) => curie2uri(context, subject)),
            predicates.map((predicate) => curie2uri(context, predicate)),
            [{ from: 0, to: 0 }]
          )
        ))
        .map(({ subject, predicate, object, type, lang }) => {
          if (object === undefined) {
            return {
              path: ['resource', uri2curie(context, subject), uri2curie(context, predicate)],
              value: null
            };
          } else if (type === 'relationship') {
            return {
              path: ['resource', uri2curie(context, subject), uri2curie(context, predicate)],
              value: $ref(['resource', uri2curie(context, getValue(object))])
            };
          }

          return {
            path: ['resource', uri2curie(context, subject), uri2curie(context, predicate)],
            value: $atom(
              uri2curie(context, getValue(object)),
              atomMetadata(
                uri2curie(context, type),
                lang
              )
            )
          };
        });
    }
  },
  {
    route: 'resource[{keys:subjects}]uri',
    get({ subjects }) {
      return Observable.from(subjects)
        .map(uri => ({
          path: ['resource', uri, 'uri'],
          value: uri
        }));
    }
  },
  {
    route: 'resource[{keys:subjects}][{keys:predicates}].length',
    get({ subjects, predicates }) {
      return Observable.from(
        groupUrisByRepo(repos)(subjects)
      )
        .mergeMap(({ repository, uris }) => (
          repository.getTriplesCount(
            uris.map((subject) => curie2uri(context, subject)),
            predicates.map((predicate) => curie2uri(context, predicate))
          ))
        )
        .map(({ subject, predicate, length }) => {
          return {
            path: ['resource', uri2curie(context, subject), uri2curie(context, predicate), 'length'],
            value: length === undefined ? null : length
          };
        });
    }
  }
]);
